#!/bin/bash
# Prints new pins for the cabinet's speech (D261): the wheels for Python 3.13 on arm64 Linux, and the
# model's files with their SHA-256. Paste them into cabinet/service/speech/requirements.lock and
# models.lock.json. Needs uv and python3.12+ on the mini.
#
#   scripts/speech/lock-wheels.sh [MOONSHINE_VERSION] [ARCH]      default 0.1.6 medium-streaming
set -euo pipefail
VERSION="${1:-0.1.6}"
ARCH="${2:-medium-streaming}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "moonshine-voice==$VERSION" > "$WORK/req.in"
uv pip compile "$WORK/req.in" --python-platform aarch64-manylinux_2_34 --python-version 3.13 --no-header -q -o "$WORK/req.txt"
uv venv -q -p 3.12 "$WORK/venv"
uv pip install -q -p "$WORK/venv" "moonshine-voice==$VERSION" pip
"$WORK/venv/bin/pip" download -q -r "$WORK/req.txt" --only-binary :all: --no-deps --python-version 3.13 --implementation cp \
  --platform manylinux_2_34_aarch64 --platform manylinux_2_28_aarch64 --platform manylinux_2_17_aarch64 --platform manylinux2014_aarch64 -d "$WORK/wheels"
echo "== requirements.lock"
for f in "$WORK"/wheels/*.whl; do
  b="$(basename "$f")"
  printf '%s==%s --hash=sha256:%s\n' "$(echo "$b" | cut -d- -f1 | tr _ - | tr 'A-Z' 'a-z')" "$(echo "$b" | cut -d- -f2)" "$(shasum -a 256 "$f" | cut -c1-64)"
done
echo "== models.lock.json"
"$WORK/venv/bin/python" - "$ARCH" <<'PY'
import hashlib, json, os, sys
from moonshine_voice import string_to_model_arch, get_model_for_language
path, _ = get_model_for_language("en", string_to_model_arch(sys.argv[1]))
files = {n: hashlib.sha256(open(os.path.join(path, n), "rb").read()).hexdigest() for n in sorted(os.listdir(path)) if os.path.isfile(os.path.join(path, n))}
print(json.dumps({"arch": sys.argv[1], "dir": os.path.basename(os.path.dirname(path)), "base_url": "https://download.moonshine.ai/" + path.split("download.moonshine.ai/")[1], "files": files}, indent=2))
PY
