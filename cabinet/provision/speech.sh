# Speech on the cabinet (D261), for both profiles. Sourced by provision.sh after step_bundle.
# Moonshine's wheels and model, each checked by its hash, from the release's own lock files:
#   cabinet/service/speech/requirements.lock    pip, --require-hashes --only-binary
#   cabinet/service/speech/models.lock.json     the model's files and their SHA-256
# A payload folder may carry them (speech/wheels/*.whl, speech/models/<file>) for a cabinet with no internet;
# otherwise they come from PyPI and download.moonshine.ai. Writes /opt/arcade/speech/speech.json, which is
# what turns real speech on in the cabinet service. Safe to run again: nothing is fetched twice.

SPEECH_HOME=/opt/arcade/speech

step_speech() {
  local src="$ARCADE_HOME/current/cabinet/service/speech" lock tag venv model_dir arch base name sha f tmp
  lock="$src/requirements.lock"
  [ -f "$lock" ] || { log "speech: no $lock in this release"; return 1; }
  install -d -m 0755 "$SPEECH_HOME"

  # 1. Python packages in their own venv, named by the lock's hash, so a new lock makes a new venv.
  tag="$(sha256sum "$lock" | cut -c1-12)"
  venv="$SPEECH_HOME/venv-$tag"
  if [ ! -x "$venv/bin/python" ]; then
    rm -rf "$venv.tmp"
    python3 -m venv "$venv.tmp"
    local from=()
    [ -d "$PAYLOAD/speech/wheels" ] && from=(--no-index --find-links "$PAYLOAD/speech/wheels")
    "$venv.tmp/bin/pip" install --quiet --disable-pip-version-check --no-cache-dir --require-hashes --only-binary :all: --no-deps "${from[@]}" -r "$lock"
    sync  # on disk before it has its final name (D334)
    mv "$venv.tmp" "$venv"
  fi
  ln -sfn "$venv" "$SPEECH_HOME/venv"

  # 2. The models, file by file, each checked by its SHA-256: the one for final words (D261) and the lighter one
  #    for words while talking (D492).
  local which dir base
  while read -r which dir base name sha; do
    install -d -m 0755 "$SPEECH_HOME/models/$dir"
    f="$SPEECH_HOME/models/$dir/$name"
    if [ -f "$f" ] && echo "$sha  $f" | sha256sum -c --status -; then continue; fi
    tmp="$f.tmp"
    if [ -f "$PAYLOAD/speech/models/$dir/$name" ]; then cp "$PAYLOAD/speech/models/$dir/$name" "$tmp"
    elif [ "$which" = final ] && [ -f "$PAYLOAD/speech/models/$name" ]; then cp "$PAYLOAD/speech/models/$name" "$tmp"
    else curl -fsSL --retry 3 -o "$tmp" "$base/$name"; fi
    echo "$sha  $tmp" | sha256sum -c --status - || { rm -f "$tmp"; log "speech: $dir/$name doesn't match its hash"; return 1; }
    sync "$tmp"  # on disk before it has its final name (D334)
    mv "$tmp" "$f"
  done < <(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const [which, x] of [["final", m], ["live", m.live]]) if (x) for (const [n, s] of Object.entries(x.files)) console.log(which, x.dir, x.base_url, n, s);' "$src/models.lock.json")
  read -r arch model_dir live_arch live_dir < <(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(m.arch, m.dir, m.live?.arch ?? "-", m.live?.dir ?? "-");' "$src/models.lock.json")
  model_dir="$SPEECH_HOME/models/$model_dir"
  chmod -R a+rX "$SPEECH_HOME"

  # 3. Proof it loads, before the service is told about it. The helper reads stdin until it closes.
  if ! "$SPEECH_HOME/venv/bin/python" "$src/moonshine_helper.py" "$model_dir" "$arch" </dev/null | head -1 | grep -q '"ready": true'; then
    log "speech: Moonshine didn't load"
    return 1
  fi
  if [ "$live_dir" != - ] && ! "$SPEECH_HOME/venv/bin/python" "$src/moonshine_helper.py" "$SPEECH_HOME/models/$live_dir" "$live_arch" </dev/null | head -1 | grep -q '"ready": true'; then
    log "speech: Moonshine's live-words model didn't load"
    return 1
  fi

  # 4. What the service reads. The helper is the current release's, so an update brings its own.
  node -e '
    const [python, helper, model_dir, arch, file, live_dir, live_arch] = process.argv.slice(1);
    const live = live_dir.endsWith("/-") ? {} : { live_model_dir: live_dir, live_arch };
    require("fs").writeFileSync(file + ".tmp", JSON.stringify({ python, helper, model_dir, arch, ...live }, null, 1) + "\n");
    require("fs").renameSync(file + ".tmp", file);' \
    "$SPEECH_HOME/venv/bin/python" "$ARCADE_HOME/current/cabinet/service/speech/moonshine_helper.py" "$model_dir" "$arch" "$SPEECH_HOME/speech.json" "$SPEECH_HOME/models/$live_dir" "$live_arch"
  log "speech: Moonshine $arch ready"
}
