-- lua/coderef.lua — Neovim 0.5+ enhancements for the coderef Vim plugin
--
-- Provides virtual-text hints and native diagnostics.
-- Called automatically from autoload/coderef.vim when Neovim 0.5+ is detected.
-- Neovim users who prefer Lua-style configuration can also call:
--
--   require('coderef').setup({ show_hints = true })

local M   = {}
local api = vim.api
local ns  = api.nvim_create_namespace('coderef')

-- ── Highlight groups ──────────────────────────────────────────────────────────

local function setup_highlights()
  -- Linked to safe defaults; users can override in their colorscheme.
  local defs = {
    CoDerefHint     = { link = 'Comment',    default = true },
    CoDerefPinned   = { link = 'Special',    default = true },
    CoDerefDangling = { link = 'DiagnosticWarn', default = true },
  }
  for name, opts in pairs(defs) do
    if vim.fn.hlID(name) == 0 then
      api.nvim_set_hl(0, name, opts)
    end
  end
end

-- ── Body parser (mirrors Python _parse_to_ref) ────────────────────────────────

local function split_colon(s)
  local parts = {}
  for p in s:gmatch('[^:]+') do parts[#parts + 1] = p end
  return parts
end

local function parse_body(body)
  local segs   = split_colon(body)
  local uuid   = segs[#segs]
  local commit, name
  local rest   = {}
  for i = 1, #segs - 1 do rest[#rest + 1] = segs[i] end

  if #rest > 0 and rest[1]:sub(1, 1) == '@' then
    commit = rest[1]:sub(2)
    local new_rest = {}
    for i = 2, #rest do new_rest[#new_rest + 1] = rest[i] end
    rest = new_rest
  end

  if #rest > 0 then
    name = table.concat(rest, ':')
  end

  return uuid, commit, name
end

-- ── Core update ───────────────────────────────────────────────────────────────

-- Refresh virtual-text hints and diagnostics for a buffer.
-- `bufnr` defaults to the current buffer (0).
function M.update(bufnr)
  bufnr = bufnr or 0
  if bufnr == 0 then bufnr = api.nvim_get_current_buf() end
  if not api.nvim_buf_is_valid(bufnr) then return end

  setup_highlights()
  api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)

  -- Delegate .coderef loading to the VimScript side (shares its mtime cache)
  local refs = vim.fn['coderef#load']()
  if vim.tbl_isempty(refs) then return end

  local lines = api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local diags = {}

  -- Lua pattern: match "to_ref:" followed by valid body characters.
  -- Body must end with exactly 8 lowercase hex chars (the UUID).
  local body_pat = 'to_ref:([%a%d@:%-._/]+)'
  local uuid_pat = '^[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]$'

  for row, line in ipairs(lines) do
    local search_from = 1
    while true do
      local ts, te, body = line:find(body_pat, search_from)
      if not ts then break end

      -- Validate: body must end with exactly 8 lowercase hex chars
      local uuid = body:match('([a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])$')
      if uuid and uuid:match(uuid_pat) then
        local parsed_uuid, commit, ref_name = parse_body(body)
        local is_pinned = commit ~= nil and commit ~= 'HEAD'
        local entry     = refs[parsed_uuid]

        if entry then
          -- Resolved: show hint with location
          local loc = entry.file .. ':' .. tostring(entry.line)
          if entry.endline and entry.endline ~= entry.line then
            loc = loc .. '-' .. tostring(entry.endline)
          end
          if entry.name and entry.name ~= '' then
            loc = loc .. ' (' .. entry.name .. ')'
          end

          local vt_text, vt_hl
          if is_pinned then
            vt_text = ' → [' .. commit .. '] ' .. loc
            vt_hl   = 'CoDerefPinned'
          else
            vt_text = ' → ' .. loc
            vt_hl   = 'CoDerefHint'
          end

          api.nvim_buf_set_extmark(bufnr, ns, row - 1, te - 1, {
            virt_text     = { { vt_text, vt_hl } },
            virt_text_pos = 'eol',
            hl_mode       = 'combine',
          })

        elseif is_pinned then
          -- Historical (pinned to a specific commit): show badge, no warning
          api.nvim_buf_set_extmark(bufnr, ns, row - 1, te - 1, {
            virt_text     = { { ' → [' .. commit .. '] (historical)', 'CoDerefPinned' } },
            virt_text_pos = 'eol',
            hl_mode       = 'combine',
          })

        else
          -- Dangling: add a diagnostic warning
          diags[#diags + 1] = {
            bufnr    = bufnr,
            lnum     = row - 1,
            col      = ts - 1,
            end_col  = te,
            severity = vim.diagnostic.severity.WARN,
            message  = "coderef: dangling ref '" .. parsed_uuid .. "' not in .coderef",
            source   = 'coderef',
          }
        end
      end

      search_from = te + 1
    end
  end

  vim.diagnostic.set(ns, bufnr, diags)
end

-- ── Lua-style setup (optional) ────────────────────────────────────────────────

-- For Neovim users who prefer configuring via Lua rather than vimrc globals:
--
--   require('coderef').setup({ show_hints = false })
--
-- This is optional — the plugin works without calling setup().
function M.setup(opts)
  opts = opts or {}
  if opts.show_hints ~= nil then
    vim.g.coderef_show_hints = opts.show_hints and 1 or 0
  end
  if opts.goto_key ~= nil then
    vim.g.coderef_goto_key = opts.goto_key
  end
  if opts.insert_key ~= nil then
    vim.g.coderef_insert_key = opts.insert_key
  end
  if opts.no_default_maps ~= nil then
    vim.g.coderef_no_default_maps = opts.no_default_maps and 1 or 0
  end
end

return M
