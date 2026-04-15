" coderef.vim — stable UUID-based code anchor navigation for Vim / Neovim
"
" Works in Vim 8+ and Neovim.
" Neovim 0.5+ gains virtual-text hints and native diagnostics via lua/coderef.lua.
"
" Install with vim-plug (plugin lives in a subdirectory of the coderef repo):
"   Plug 'erncyp/coderef', { 'rtp': 'vim-plugin' }
"
" Or point any plugin manager at the vim-plugin/ directory directly.
" Manual:
"   set runtimepath+=/path/to/coderef/vim-plugin

if exists('g:loaded_coderef') | finish | endif
let g:loaded_coderef = 1

" ── User-configurable options ─────────────────────────────────────────────────
"
" Override any of these in your vimrc before the plugin loads, e.g.:
"   let g:coderef_no_default_maps = 1
"   let g:coderef_goto_key = 'gd'

" Key mappings (set to '' to disable individually)
let g:coderef_goto_key         = get(g:, 'coderef_goto_key',         '<leader>cg')
let g:coderef_preview_key      = get(g:, 'coderef_preview_key',      '<leader>cp')
let g:coderef_insert_key       = get(g:, 'coderef_insert_key',       '<leader>ci')
let g:coderef_insert_range_key = get(g:, 'coderef_insert_range_key', '<leader>cr')
" Set 1 to skip all default mappings
let g:coderef_no_default_maps  = get(g:, 'coderef_no_default_maps',  0)
" Set 0 to disable virtual-text hints (Neovim only)
let g:coderef_show_hints       = get(g:, 'coderef_show_hints',       1)

" ── Commands ──────────────────────────────────────────────────────────────────

" Jump to the anchor that to_ref: under the cursor points to
command! CoDerefGoto        call coderef#goto()

" Open the anchor's file in the preview window (Ctrl-W z to close)
command! CoDerefPreview     call coderef#preview()

" Insert a new ref:<uuid> anchor at the end of the current line
command! CoDerefInsert      call coderef#insert()

" Insert a ref:<uuid>:start / ref:<uuid>:end pair around a visual selection
command! -range CoDerefInsertRange call coderef#insert_range()

" Run `coderef check` and load any dangling refs into the quickfix list
command! CoDerefCheck       call coderef#check()

" ── Default mappings ──────────────────────────────────────────────────────────

if !g:coderef_no_default_maps
  if g:coderef_goto_key !=# ''
    execute 'nnoremap <silent> ' . g:coderef_goto_key . ' :CoDerefGoto<CR>'
  endif
  if g:coderef_preview_key !=# ''
    execute 'nnoremap <silent> ' . g:coderef_preview_key . ' :CoDerefPreview<CR>'
  endif
  if g:coderef_insert_key !=# ''
    execute 'nnoremap <silent> ' . g:coderef_insert_key . ' :CoDerefInsert<CR>'
  endif
  if g:coderef_insert_range_key !=# ''
    execute 'vnoremap <silent> ' . g:coderef_insert_range_key . ' :CoDerefInsertRange<CR>'
  endif
endif

" ── Autocmds ──────────────────────────────────────────────────────────────────

augroup coderef
  autocmd!

  " Neovim 0.5+: refresh virtual text when a buffer is read or after insert
  if has('nvim-0.5') && g:coderef_show_hints
    autocmd BufReadPost,BufWritePost,InsertLeave,TextChanged * call coderef#update_hints(+expand('<abuf>'))
  endif

  " Invalidate the .coderef cache whenever the file is written
  autocmd BufWritePost .coderef call coderef#_invalidate_cache()
augroup END
