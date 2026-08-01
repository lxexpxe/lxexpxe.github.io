# Aviso de git pull/push pendiente para este proyecto.
#
# Cárgalo desde tu ~/.zshrc con una línea como:
#   [ -f "/ruta/a/lxexpxe.github.io/scripts/git-sync-check.zsh" ] && source "/ruta/a/lxexpxe.github.io/scripts/git-sync-check.zsh"
#
# Corre al entrar (cd) a la carpeta del proyecto, y también al abrir una
# terminal que ya arranca ahí. Solo avisa, nunca hace pull/push por su cuenta.
# Usa `git -C` en vez de `cd` a propósito: un `cd` real aquí dispararía de
# nuevo este mismo hook (chpwd) y crearía una recursión infinita.
#
# La ruta del repo se captura aquí, a nivel superior del script (donde $0 sí
# es la ruta del archivo) — dentro de una función de zsh, $0 es el nombre de
# la función, no del archivo, así que no se puede resolver ahí adentro.
_LXEXPXE_REPO_DIR="${0:A:h:h}"

_lxexpxe_git_sync_check() {
  local repo="$_LXEXPXE_REPO_DIR"
  [[ "$PWD" == "$repo"* ]] || return
  git -C "$repo" fetch --quiet origin main 2>/dev/null || return
  local behind ahead
  behind=$(git -C "$repo" rev-list --count HEAD..origin/main 2>/dev/null)
  ahead=$(git -C "$repo" rev-list --count origin/main..HEAD 2>/dev/null)
  [[ "$behind" -gt 0 ]] && echo "⚠️  lxexpxe.github.io: tu rama local está $behind commit(s) detrás de origin/main — corre 'git pull'."
  [[ "$ahead" -gt 0 ]] && echo "ℹ️  lxexpxe.github.io: tienes $ahead commit(s) locales sin subir — corre 'git push'."
}

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _lxexpxe_git_sync_check
[[ "$PWD" == "$_LXEXPXE_REPO_DIR"* ]] && _lxexpxe_git_sync_check
