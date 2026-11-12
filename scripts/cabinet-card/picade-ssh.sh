# The Picade's admin SSH on the mini: the one place it's defined (D259). flash.mjs makes the key here when it
# writes the card; connect-picade.sh, driver-keyboard.sh, twin.mjs and the Manager reach the cabinet with it.
# Shell scripts source this file; Node reads it through scripts/cabinet-card/picade.mjs. GSA_CABINET_DIR moves it.
PICADE_HOST=arcade.local
PICADE_DATA_ROOT=game-studio-data
PICADE_DIR_UNDER_DATA=cabinets/arcade
PICADE_KEY_NAME=arcade_ed25519
PICADE_DIR="${GSA_CABINET_DIR:-$HOME/$PICADE_DATA_ROOT/$PICADE_DIR_UNDER_DATA}"
