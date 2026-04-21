" autoload/coderef.vim — lazy-loaded core functions
" Works in Vim 8+ and Neovim.

" ── Cache ─────────────────────────────────────────────────────────────────────

let s:refs_cache = {}   " {uuid: {file, line, endline, name, location}}
let s:refs_mtime = -1   " mtime of .coderef when cache was last filled
let s:refs_root  = ''   " repo root at last cache fill

" ── Public: repo + data loading ───────────────────────────────────────────────

" Return the absolute path to the repository root, or '' if not found.
function! coderef#find_root() abort
  let l:result = system('git rev-parse --show-toplevel 2>/dev/null')
  if v:shell_error == 0
    return trim(l:result)
  endif
  " Fallback: walk up from current file looking for .coderef
  let l:dir = expand('%:p:h')
  if l:dir ==# '' | let l:dir = getcwd() | endif
  while 1
    if filereadable(l:dir . '/.coderef') | return l:dir | endif
    let l:parent = fnamemodify(l:dir, ':h')
    if l:parent ==# l:dir | break | endif
    let l:dir = l:parent
  endwhile
  return ''
endfunction

" Load .coderef into a dict, using an mtime-based cache.
" Returns {uuid: {file, line, endline, name, location}}.
function! coderef#load() abort
  let l:root = coderef#find_root()
  if l:root ==# '' | return {} | endif

  let l:path  = l:root . '/.coderef'
  let l:mtime = getftime(l:path)

  if l:mtime == s:refs_mtime && l:root ==# s:refs_root && !empty(s:refs_cache)
    return s:refs_cache
  endif

  let s:refs_cache = {}
  let s:refs_mtime = l:mtime
  let s:refs_root  = l:root

  if !filereadable(l:path) | return s:refs_cache | endif

  for l:raw in readfile(l:path)
    let l:line = trim(l:raw)
    if l:line ==# '' || l:line[0] ==# '#' | continue | endif

    " Format: <uuid> <file>:<line>[-<endline>] [<name>]
    let l:parts = split(l:line, '\s\+')
    if len(l:parts) < 2 | continue | endif

    let l:uuid     = l:parts[0]
    let l:loc      = l:parts[1]
    let l:ref_name = len(l:parts) >= 3 ? l:parts[2] : ''

    " Split location into file and line spec
    let l:colon = strridx(l:loc, ':')
    if l:colon < 0 | continue | endif
    let l:file     = l:loc[:l:colon - 1]
    let l:linespec = l:loc[l:colon + 1:]
    let l:dash     = stridx(l:linespec, '-')

    if l:dash >= 0
      let l:startline = str2nr(l:linespec[:l:dash - 1])
      let l:endline   = str2nr(l:linespec[l:dash + 1:])
    else
      let l:startline = str2nr(l:linespec)
      let l:endline   = l:startline
    endif

    let s:refs_cache[l:uuid] = {
      \ 'file':     l:file,
      \ 'line':     l:startline,
      \ 'endline':  l:endline,
      \ 'name':     l:ref_name,
      \ 'location': l:loc,
    \ }
  endfor

  return s:refs_cache
endfunction

function! coderef#_invalidate_cache() abort
  let s:refs_mtime = -1
endfunction

" ── Public: cursor utilities ──────────────────────────────────────────────────

" Return the UUID from the to_ref: token under the cursor, or ''.
" Handles all four forms: uuid, @commit:uuid, name:uuid, @commit:name:uuid.
function! coderef#uuid_under_cursor() abort
  let l:line = getline('.')
  let l:col  = col('.') - 1   " 0-indexed byte offset

  " Match the full to_ref: token — UUID is always the last 8 hex chars
  let l:pat = '\<to_ref:\(@[-A-Za-z0-9._/@]\+:\)\?\([a-z][a-z0-9-]*:\)\?[a-f0-9]\{8\}'
  let l:pos = 0
  while 1
    let l:m = matchstrpos(l:line, l:pat, l:pos)
    if l:m[1] < 0 | break | endif
    if l:m[1] <= l:col && l:col < l:m[2]
      return matchstr(l:m[0], '[a-f0-9]\{8\}$')
    endif
    let l:pos = l:m[2]
  endwhile
  return ''
endfunction

" ── Public: navigation ────────────────────────────────────────────────────────

" Jump to the anchor that to_ref: under the cursor points to.
function! coderef#goto() abort
  let [l:uuid, l:ref, l:root] = s:resolve_cursor()
  if l:uuid ==# '' | return | endif

  execute 'edit ' . fnameescape(l:root . '/' . l:ref['file'])
  call cursor(l:ref['line'], 1)
  normal! zz
endfunction

" Open the anchor's file in the preview window (close with Ctrl-W z).
function! coderef#preview() abort
  let [l:uuid, l:ref, l:root] = s:resolve_cursor()
  if l:uuid ==# '' | return | endif

  execute 'pedit +' . l:ref['line'] . ' ' . fnameescape(l:root . '/' . l:ref['file'])
endfunction

" ── Public: authoring ─────────────────────────────────────────────────────────

" Append a new  ref:<uuid>  anchor (with correct comment prefix) to the
" current line.  Prompts for an optional name.
function! coderef#insert() abort
  let l:uuid    = coderef#_gen_uuid()
  let l:comment = coderef#_comment_prefix()

  let l:name = input('Anchor name (optional, e.g. auth-guard): ')
  redraw
  let l:anchor = empty(l:name)
    \ ? printf('%s ref:%s', l:comment, l:uuid)
    \ : printf('%s ref:%s:%s', l:comment, l:uuid, l:name)

  call setline('.', getline('.') . '  ' . l:anchor)
  echo 'coderef: inserted ' . (empty(l:name) ? 'ref:' . l:uuid : 'ref:' . l:uuid . ':' . l:name)
        \ . '  (commit to update .coderef)'
endfunction

" Wrap a visual selection with ref:<uuid>:start / ref:<uuid>:end.
function! coderef#insert_range() abort
  let l:uuid    = coderef#_gen_uuid()
  let l:comment = coderef#_comment_prefix()
  let l:s_line  = line("'<")
  let l:e_line  = line("'>")

  if l:s_line == l:e_line
    call setline(l:s_line, getline(l:s_line)
          \ . printf('  %s ref:%s:start', l:comment, l:uuid))
    echo printf('coderef: inserted ref:%s:start — add ref:%s:end at block end', l:uuid, l:uuid)
  else
    " Modify end line first so start-line insertion doesn't shift it
    call setline(l:e_line, getline(l:e_line)
          \ . printf('  %s ref:%s:end', l:comment, l:uuid))
    call setline(l:s_line, getline(l:s_line)
          \ . printf('  %s ref:%s:start', l:comment, l:uuid))
    echo printf('coderef: inserted range ref:%s  (commit to update .coderef)', l:uuid)
  endif
endfunction

" ── Public: info / hover ──────────────────────────────────────────────────────

" Show a floating info card for the to_ref: under the cursor.
" This is the hover-card equivalent of the VSCode extension.
" Neovim 0.5+ → floating window.  Vim 8.1.1517+ → popup.  Older → echo.
function! coderef#info() abort
  let l:uuid = coderef#uuid_under_cursor()
  if l:uuid ==# ''
    echo 'coderef: no to_ref: under cursor'
    return
  endif

  let l:refs   = coderef#load()
  let l:ref    = get(l:refs, l:uuid, {})
  let l:commit = matchstr(getline('.'), '\<to_ref:@\zs[^: \t]\+\ze:')

  if empty(l:ref)
    let l:lines = l:commit !=# ''
      \ ? ['coderef ' . l:uuid, '-> [' . l:commit . '] (historical)']
      \ : ['coderef ' . l:uuid, '!! dangling — not in .coderef']
    call s:show_float(l:lines)
    return
  endif

  let l:loc = l:ref['file'] . ':' . l:ref['line']
  if l:ref['endline'] != l:ref['line']
    let l:loc .= '-' . l:ref['endline'] . ' (range)'
  endif
  let l:title = 'coderef ' . l:uuid
  if l:ref['name'] !=# '' | let l:title .= ' — ' . l:ref['name'] | endif
  call s:show_float([l:title, '-> ' . l:loc])
endfunction

" Internal: show lines in the best available popup for the current runtime.
let g:_coderef_float_win = -1

function! s:show_float(lines) abort
  if has('nvim-0.5')
    call coderef#_close_float()
    let l:buf = nvim_create_buf(0, 1)
    call nvim_buf_set_lines(l:buf, 0, -1, 0, a:lines)
    call nvim_buf_set_option(l:buf, 'modifiable', 0)
    let l:width = max(map(copy(a:lines), 'strwidth(v:val)')) + 2
    let g:_coderef_float_win = nvim_open_win(l:buf, 0, {
      \ 'relative': 'cursor',
      \ 'row': 1,
      \ 'col': 0,
      \ 'width': l:width,
      \ 'height': len(a:lines),
      \ 'style': 'minimal',
      \ 'border': 'rounded',
    \ })
    augroup coderef_float_close
      autocmd!
      autocmd CursorMoved,CursorMovedI,InsertEnter,BufLeave * ++once
        \ call coderef#_close_float()
    augroup END
  elseif exists('*popup_create')
    call popup_create(a:lines, {'padding': [0, 1, 0, 1], 'border': [1, 1, 1, 1], 'time': 3000})
  else
    echo join(a:lines, '  |  ')
  endif
endfunction

function! coderef#_close_float() abort
  if g:_coderef_float_win >= 0
    if nvim_win_is_valid(g:_coderef_float_win)
      call nvim_win_close(g:_coderef_float_win, 1)
    endif
    let g:_coderef_float_win = -1
  endif
endfunction

" ── Public: completion ────────────────────────────────────────────────────────

" Omnifunc/completefunc for to_ref: UUID completion.
"
" Auto-enabled as omnifunc when g:coderef_set_omnifunc = 1 (default) and
" no other omnifunc is set for the buffer.  Trigger in insert mode with:
"   <C-x><C-o>   if set as omnifunc
"   <C-x><C-u>   if set as completefunc
"
" To opt out: let g:coderef_set_omnifunc = 0
function! coderef#complete(findstart, base) abort
  if a:findstart
    " Walk back over hex chars to find where the UUID being typed starts
    let l:line  = getline('.')
    let l:start = col('.') - 1
    while l:start > 0 && l:line[l:start - 1] =~# '[a-f0-9]'
      let l:start -= 1
    endwhile
    " Only complete if preceded by 'to_ref:' (with optional @commit/name prefix)
    let l:before = l:start > 0 ? l:line[:l:start - 1] : ''
    if l:before =~# '\<to_ref:[^[:space:]]*$'
      return l:start
    endif
    return -3   " not in a to_ref: context — cancel silently
  else
    let l:refs  = coderef#load()
    let l:items = []
    for [l:uuid, l:ref] in items(l:refs)
      if a:base ==# '' || l:uuid[:len(a:base) - 1] ==# a:base
        let l:loc = l:ref['file'] . ':' . l:ref['line']
        if l:ref['endline'] != l:ref['line']
          let l:loc .= '-' . l:ref['endline']
        endif
        let l:menu = l:ref['name'] !=# ''
          \ ? l:loc . ' (' . l:ref['name'] . ')'
          \ : l:loc
        call add(l:items, {'word': l:uuid, 'menu': l:menu, 'kind': 'r'})
      endif
    endfor
    " Named refs sort first (menu contains parentheses when named)
    call sort(l:items, {a, b ->
      \ (a.menu =~# '(' ? 0 : 1) - (b.menu =~# '(' ? 0 : 1)})
    return l:items
  endif
endfunction

" ── Public: checking ──────────────────────────────────────────────────────────

" Run `coderef check`.  On success prints a summary; on failure populates
" the quickfix list with dangling refs and opens it.
function! coderef#check() abort
  let l:root = coderef#find_root()
  if l:root ==# ''
    echohl WarningMsg | echo 'coderef: no repo root found' | echohl None
    return
  endif

  let l:cmd = 'cd ' . shellescape(l:root) . ' && coderef check 2>&1'
  let l:out  = systemlist(l:cmd)
  let l:fail = v:shell_error

  if !l:fail
    echo join(l:out, "\n")
    return
  endif

  " Parse "  path/to/file:31: to_ref:uuid" lines → quickfix entries
  let l:qf = []
  for l:line in l:out
    let l:m = matchlist(l:line, '^\s\+\(.\+\):\(\d\+\): to_ref:\(.\+\)')
    if !empty(l:m)
      call add(l:qf, {
        \ 'filename': l:root . '/' . l:m[1],
        \ 'lnum':     str2nr(l:m[2]),
        \ 'text':     'dangling to_ref:' . l:m[3],
        \ 'type':     'W',
      \ })
    endif
  endfor

  if !empty(l:qf)
    call setqflist(l:qf)
    copen
  else
    echo join(l:out, "\n")
  endif
endfunction

" ── Public: Neovim virtual-text bridge ───────────────────────────────────────

" Called from the BufReadPost / InsertLeave autocmd on Neovim 0.5+.
" Delegates to the Lua module so VimScript stays unaware of nvim_buf_set_extmark.
function! coderef#update_hints(bufnr) abort
  if !has('nvim-0.5') || !g:coderef_show_hints | return | endif
  call v:lua.require('coderef').update(a:bufnr)
endfunction

" ── Private helpers ───────────────────────────────────────────────────────────

" Resolve the to_ref: under the cursor → [uuid, ref_dict, root].
" Returns ['', {}, ''] and prints an error if resolution fails.
function! s:resolve_cursor() abort
  let l:uuid = coderef#uuid_under_cursor()
  if l:uuid ==# ''
    echo 'coderef: no to_ref: under cursor'
    return ['', {}, '']
  endif

  let l:refs = coderef#load()
  if !has_key(l:refs, l:uuid)
    echohl WarningMsg
    echo 'coderef: dangling ref — ' . l:uuid . ' not in .coderef'
    echohl None
    return ['', {}, '']
  endif

  return [l:uuid, l:refs[l:uuid], coderef#find_root()]
endfunction

" Generate a random 8-char hex UUID.
function! coderef#_gen_uuid() abort
  if executable('python3')
    return trim(system("python3 -c 'import secrets; print(secrets.token_hex(4))'"))
  elseif executable('openssl')
    return trim(system('openssl rand -hex 4'))
  else
    " Last resort: combine timer ticks with getpid()
    return printf('%08x', (localtime() * 1000003) ^ getpid())
  endif
endfunction

" Return the line-comment prefix for the current filetype,
" using Vim's built-in commentstring setting.
function! coderef#_comment_prefix() abort
  " commentstring is like "# %s" or "// %s" — take everything before %s
  let l:cs = trim(substitute(&commentstring, '\s*%s.*', '', ''))
  return empty(l:cs) ? '//' : l:cs
endfunction
