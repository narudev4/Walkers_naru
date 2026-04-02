# ElevenLabs チャンク結合時のクロスフェード必須

## 問題
ElevenLabsで長文を複数チャンクに分割→API生成→ffmpeg concatで結合すると、チャンク境界で「ブツッ」と音が途切れる。

## 原因
- ElevenLabsは各チャンクの先頭/末尾に微妙なフェードイン/フェードアウトを自動付与する
- ffmpeg concat（-c copy）は単純バイナリ結合なので、このフェード部分がそのまま残り「切れ」として聞こえる
- 特にチャンク末尾のフェードアウト + 次チャンク先頭のフェードインが重なると顕著

## 解決策（必須）
チャンク結合時に以下の処理を行う:

1. **各チャンクの先頭/末尾の無音をトリム**（silenceremoveフィルタ）
2. **チャンク間に0.3秒の無音を挿入**（セクション遷移の自然な間として）
3. **結合はフィルタベースで行う**（concat -c copyではなく、amixまたはfilter_complexを使用）

```bash
# 正しい結合方法: 各チャンクをトリム→0.3秒無音挿入→filter_complex concat
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -acodec pcm_s16le /tmp/silence_pad.wav

# concat demuxerではなくfilter_complexのconcatフィルタを使う
ffmpeg -y \
  -i /tmp/chunk1_pcm_trimmed.wav \
  -i /tmp/silence_pad.wav \
  -i /tmp/chunk2_pcm_trimmed.wav \
  -i /tmp/silence_pad.wav \
  -i /tmp/chunk3_pcm_trimmed.wav \
  -filter_complex "[0][1][2][3][4]concat=n=5:v=0:a=1[out]" \
  -map "[out]" -acodec pcm_s16le -ar 44100 -ac 1 output.wav
```

## 絶対にやらないこと
- `ffmpeg -f concat -safe 0 -c copy` での単純結合 → 切れの原因
- チャンク境界の問題を「分割位置を変える」だけで対処 → 根本解決にならない

## 適用日
2026-03-30
