#!/bin/bash
# Runs on the cabinet. The key belongs in /etc/arcade/service.json, owned by arcade, mode 0600,
# and nowhere else (D131, D155). Prints only file names, never a match.
#
# sudo logs its command lines to the journal, so the patterns stay in a file: on a sudo
# command line they would put the very text this looks for into the journal.
fail=0
patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT
printf '%s\n' 'sk-ant-' 'anthropic_api_key' > "$patterns"

if sudo test -e /etc/arcade/service.json; then
  perms="$(sudo stat -c '%a %U' /etc/arcade/service.json)"
  if [ "$perms" != "600 arcade" ]; then echo "service.json is $perms, not 600 arcade"; fail=1; fi
fi
found="$(sudo grep -rIl --exclude=service.json -f "$patterns" /etc/arcade /var/lib/arcade/carts /var/lib/arcade/logs /home/cabinet /home/arcade 2>/dev/null || true)"
if [ -n "$found" ]; then
  echo "found outside service.json:"; echo "$found"; fail=1
fi
# Only the key's own prefix here: a field's name in a logged command isn't a leak.
if sudo journalctl --no-pager -o cat 2>/dev/null | grep -q 'sk-ant-'; then echo "found in the journal"; fail=1; fi
exit "$fail"
