#!/bin/zsh
# 添付画像などの元画像から、ししゅまおのアイコン一式を作り直す。
#   使い方: zsh tools/make-icons.sh <元画像のパス>
# 例:       zsh tools/make-icons.sh ~/Desktop/shishumao.png
set -e
root="${0:A:h}/.."
src="$1"
# 引数なしのときは、アプリのフォルダに置かれた一番新しい画像を使う
if [[ -z "$src" ]]; then
  src=$(find "$root" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.heic" \) -print0 2>/dev/null \
        | xargs -0 ls -t 2>/dev/null | head -1)
fi
if [[ -z "$src" || ! -f "$src" ]]; then
  echo "画像が見つかりません。アプリのフォルダに画像を置くか、パスを指定してください:" >&2
  echo "  zsh tools/make-icons.sh <元画像のパス>" >&2
  exit 1
fi
echo "元画像: $src"
out="$root/assets"
tmp="$(mktemp -d)"

# 1) 正方形に整える（短辺に合わせて中央を切り出し）
w=$(sips -g pixelWidth  "$src" | tail -1 | awk '{print $2}')
h=$(sips -g pixelHeight "$src" | tail -1 | awk '{print $2}')
side=$(( w < h ? w : h ))
sips -s format png -c $side $side "$src" --out "$tmp/square.png" >/dev/null   # 中央クロップ

# 2) 各サイズを書き出し
cp "$tmp/square.png" "$out/icon-source.png"
for s in 512 192 180 152 120; do
  cp "$tmp/square.png" "$out/icon-$s.png"
  sips -z $s $s "$out/icon-$s.png" >/dev/null
done
cp "$out/icon-180.png" "$out/apple-touch-icon.png"
cp "$out/icon-120.png" "$out/favicon.png"

# 3) 画面ヘッダーのアイコンを生成した PNG に向ける
python3 - "$root" <<'PY'
import sys, pathlib, re
root = pathlib.Path(sys.argv[1])
p = root / 'index.html'
s = p.read_text()
s = re.sub(r'(class="appbar__icon" src=")[^"]+(")', r'\1assets/icon-512.png\2', s)
p.write_text(s)
PY

echo "アイコンを $src から作り直しました:"
ls -la "$out" | grep -E "icon-|apple-touch|favicon"
