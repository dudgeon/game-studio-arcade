#!/bin/bash
# Prints the virtual cabinet's state without ever launching UTM: started, stopped, absent, or utm-not-running.
#
#   scripts/virtual-cabinet/vm-state.sh       exit 0 if started, 1 otherwise, 3 if UTM isn't running
#
# Never call utmctl while UTM isn't running: utmctl launches UTM itself, and that opens UTM's window on
# Geoff's screen (D149, D156). It happened on 2026-11-11 at 03:02:26 UTC, from this project's own
# `utmctl status`, with the VM already down. Check `pgrep -x UTM` first; start UTM hidden with
# `open -gj /Applications/UTM.app`, as up.sh does.
if ! pgrep -x UTM >/dev/null; then
  echo utm-not-running
  exit 3
fi
state="$(/Applications/UTM.app/Contents/MacOS/utmctl status arcade-virtual 2>/dev/null || echo absent)"
echo "$state"
[ "$state" = started ]
