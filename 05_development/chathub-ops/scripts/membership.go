// Mirror of a self-written patch applied to the LINE bridge source in WSL at
// /opt/chathub/src/matrix-line-messenger/pkg/connector/membership.go.
// Re-apply after re-cloning the upstream repo (see infra/bridges/README).
//
// Upstream's connector never wired Matrix membership to LINE, so inviting a
// ghost into a portal only ever changed Matrix state — the person was never
// added to the LINE group, and the room kept a permanently "invited" member
// that LINE knew nothing about. The client library already had the call
// (pkg/line/methods.go InviteIntoChat); this just connects the two.

package connector

import (
	"context"
	"fmt"
	"strings"

	"maunium.net/go/mautrix/bridgev2"

	"github.com/highesttt/matrix-line-messenger/pkg/line"
)

var _ bridgev2.MembershipHandlingNetworkAPI = (*LineClient)(nil)

// HandleMatrixMembership forwards a Matrix invite to LINE as a group
// invitation. Every other membership transition is ignored: LINE's own
// semantics for leaving and removing differ enough from Matrix's that guessing
// at them would do something the user didn't ask for, and silently ignoring is
// the same behaviour as before this file existed.
func (lc *LineClient) HandleMatrixMembership(
	ctx context.Context,
	msg *bridgev2.MatrixMembershipChange,
) (*bridgev2.MatrixMembershipResult, error) {
	if msg.Type != bridgev2.Invite {
		return nil, nil
	}

	ghost, ok := msg.Target.(*bridgev2.Ghost)
	if !ok {
		return nil, fmt.Errorf("only LINE users can be invited to a LINE chat")
	}
	mid := string(ghost.ID)
	chatMid := string(msg.Portal.ID)

	// LINE mids are prefixed by kind: U=user, C=group chat, R=room, S=square.
	// (Observed on this account's portals: groups are "C4iZgH1X…", the 1:1 with
	// a group mid is "C…" and a 1:1 is "U…" — upper case, so compare case-insensitively
	// rather than assuming the lower-case form the docs use.)
	// A portal whose id is a *user* mid is a 1:1 chat, which has no member list
	// to add to — inviting there would have to silently create a new group,
	// which is not what "add to this conversation" means.
	if chatMid == "" || strings.EqualFold(chatMid[:1], "u") {
		return nil, fmt.Errorf("1:1のLINEトークにはメンバーを追加できません（新しいグループを作成してください）")
	}

	// Same recovery dance as every other call in this connector: the access
	// token expires quietly and the first request after that fails. Upstream
	// folded that retry into callLine, so use it instead of hand-rolling the
	// shouldAttemptTokenRecovery/recoverToken pair this patch used to call.
	_, err := lc.callLine(ctx, func(client *line.Client) error {
		return client.InviteIntoChat(chatMid, []string{mid})
	})
	if err != nil {
		return nil, fmt.Errorf("failed to invite %s into LINE chat %s: %w", mid, chatMid, err)
	}

	lc.UserLogin.Bridge.Log.Info().
		Str("chat_mid", chatMid).
		Str("invitee_mid", mid).
		Msg("Invited user into LINE chat")

	// The invite is now pending on LINE's side; the member appears for real
	// once they accept and LINE syncs the chat back to us.
	return &bridgev2.MatrixMembershipResult{}, nil
}
