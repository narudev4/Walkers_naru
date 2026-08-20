#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name('claude_session_hub.py')
SPEC = importlib.util.spec_from_file_location('claude_session_hub', MODULE_PATH)
hub = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(hub)


class QuickRunCommandTest(unittest.TestCase):
    def test_stream_json_print_command_includes_verbose(self):
        cmd = hub.quick_run_command('abc-123', '次をやって')

        self.assertEqual(cmd[:2], ['claude', '--resume'])
        self.assertIn('--permission-mode', cmd)
        self.assertIn('auto', cmd)
        self.assertIn('--output-format', cmd)
        self.assertIn('stream-json', cmd)
        self.assertIn('--verbose', cmd)
        self.assertIn('-p', cmd)
        self.assertEqual(cmd[-1], '次をやって')


class RunDiagnosisTest(unittest.TestCase):
    def test_explains_missing_verbose_error(self):
        diagnosis = hub.diagnose_quick_run_failure(
            raw='Error: When using --print, --output-format=stream-json requires --verbose',
            output='',
            error='',
            returncode=1,
        )

        self.assertIn('--verbose', diagnosis['summary'])
        self.assertEqual(diagnosis['kind'], 'missing_verbose')

    def test_explains_authentication_failure(self):
        diagnosis = hub.diagnose_quick_run_failure(
            raw='{"error":"authentication_failed"}',
            output='Not logged in · Please run /login',
            error='',
            returncode=1,
        )

        self.assertEqual(diagnosis['kind'], 'authentication')
        self.assertIn('/login', diagnosis['nextAction'])


class ResumeBriefTest(unittest.TestCase):
    def test_builds_resume_brief_from_past_messages(self):
        session = {
            'title': '提案書修正',
            'projectName': 'マベル',
            'taskText': '価格表の整合性を確認する',
            'lastUser': '最低額の話は削除して、AIっぽさを消して。',
            'lastAssistant': '確認が必要です。次に提案書の価格表を見直します。',
        }
        messages = [
            {'role': 'user', 'timestamp': '2026-07-13T01:00:00Z', 'text': '初回MTG後のお礼メールを作って'},
            {'role': 'assistant', 'timestamp': '2026-07-13T01:02:00Z', 'text': '決定: メール送信は直接せず下書きのみ作成。'},
            {'role': 'user', 'timestamp': '2026-07-17T01:00:00Z', 'text': '最低額の話は削除して、AIっぽさを消して。'},
            {'role': 'assistant', 'timestamp': '2026-07-17T01:02:00Z', 'text': 'TODO: 提案書の価格表を検証する。'},
        ]

        brief = hub.build_resume_brief(session, messages, ['続きから進めて'])

        self.assertEqual(brief['projectName'], 'マベル')
        self.assertIn('初回MTG後のお礼メール', brief['past'])
        self.assertIn('価格表の整合性', brief['now'])
        self.assertTrue(any('下書きのみ' in item for item in brief['constraints']))
        self.assertTrue(any('価格表' in item for item in brief['nextActions']))
        self.assertIn('このセッションを再開します', brief['resumePrompt'])


if __name__ == '__main__':
    unittest.main()
