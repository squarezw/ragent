#!/bin/bash
# Pick up any .ttf/.ttc/.otf files dropped into /usr/share/fonts/custom
# (bind-mounted from ./onlyoffice/fonts on the host) and register them with
# both fontconfig and OnlyOffice's font cache so they appear in the editor's
# font dropdown. Skipped when the contents haven't changed since last run —
# documentserver-generate-allfonts.sh is a 10–30s rescan we don't want on
# every restart.

set -e

CUSTOM_FONTS_DIR="/usr/share/fonts/custom"
DIGEST_FILE="/var/www/onlyoffice/Data/.custom-fonts.sha"

font_list=$(find "$CUSTOM_FONTS_DIR" -maxdepth 1 -type f \
    \( -iname '*.ttf' -o -iname '*.ttc' -o -iname '*.otf' \) \
    -printf '%f %s %T@\n' | sort)

if [ -z "$font_list" ]; then
    echo "[custom-fonts] No fonts found in $CUSTOM_FONTS_DIR; skipping."
else
    digest=$(printf '%s' "$font_list" | sha256sum | cut -d' ' -f1)
    if [ "$digest" = "$(cat "$DIGEST_FILE" 2>/dev/null)" ]; then
        echo "[custom-fonts] $CUSTOM_FONTS_DIR unchanged; skipping regeneration."
    else
        echo "[custom-fonts] Registering fonts from $CUSTOM_FONTS_DIR ..."
        fc-cache -f "$CUSTOM_FONTS_DIR" >/dev/null
        documentserver-generate-allfonts.sh true
        echo "$digest" > "$DIGEST_FILE"
    fi
fi

exec /app/ds/run-document-server.sh
