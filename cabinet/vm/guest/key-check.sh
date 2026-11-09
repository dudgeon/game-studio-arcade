#!/bin/bash
# Runs on the cabinet. The key belongs in /etc/arcade/service.json, owned by arcade, mode 0600,
# and nowhere else (D131, D155). Prints only file names, never a match.
fail=0
if sudo test -e /etc/arcade/service.json; then
  perms="$(sudo stat -c '%a %U' /etc/arcade/service.json)"
  if [ "$perms" != "600 arcade" ]; then echo "service.json is $perms, not 600 arcade"; fail=1; fi
fi
if found="$(sudo grep -rIl --exclude=service.json -e 'sk-ant-' -e 'anthropic_api_key' /etc/arcade /var/lib/arcade/carts /var/lib/arcade/logs /home/cabinet /home/arcade 2>/dev/null)" && [ -n "$found" ]; then
  echo "found outside service.json:"; echo "$found"; fail=1
fi
if sudo journalctl --no-pager -o cat 2>/dev/null | grep -q 'sk-ant-'; then echo "found in the journal"; fail=1; fi
exit "$fail"
