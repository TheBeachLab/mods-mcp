---
description: Guide for using the Mods CE MCP tools to run digital fabrication workflows
allowed-tools: [mcp__mods__get_server_status, mcp__mods__list_programs, mcp__mods__list_modules, mcp__mods__get_module_info, mcp__mods__load_program, mcp__mods__get_program_state, mcp__mods__set_parameter, mcp__mods__trigger_action, mcp__mods__export_file, mcp__mods__create_program, mcp__mods__save_program, Read, Glob, Grep, WebFetch]
---

# Mods CE MCP Workflow Guide

You have access to 11 MCP tools that control a Mods CE browser instance for digital fabrication. This guide teaches you how to use them correctly.

## Quick Reference: Tool Sequence

A typical workflow follows this order:

1. `get_server_status` — Verify server is running and browser is connected
2. `list_programs` — Browse available programs by category
3. `load_program` — Load a program into the browser
4. `get_program_state` — Read all modules, parameters, connections, and switch states
5. `set_parameter` — Configure parameters (tool diameter, speed, thresholds, etc.)
6. `load_file` — Inject input files (SVG, PNG) into reader modules
7. `trigger_action` — Click buttons (calculate, presets, view, etc.)
8. `export_file` — Retrieve the generated output file

## Critical: On/Off Switch Gating Pattern

Machine programs (under `programs/machines/`) use **on/off switch modules as gates** at the end of the pipeline. This is the most common source of workflow failures.

**Default configuration in most machine programs:**
- On/off switch → **WebUSB** (sends to physical machine): **ON** (checked)
- On/off switch → **save file** (saves toolpath to disk): **OFF** (unchecked)

**To save output to a file instead of sending to a machine, you MUST:**
1. Call `get_program_state` to see all modules with their `connectedTo` fields
2. Find the `on/off` module whose `connectedTo` includes `save file`
3. Check its checkbox param — if `"value": "false"`, it's OFF and blocking output
4. Use `set_parameter` to toggle it ON:
   ```
   module_name: "on/off:<module_id>"  (e.g., "on/off:0.372505992508834")
   parameter: ""  (empty string — the checkbox has no label)
   value: "true"
   ```
5. Optionally toggle the WebUSB on/off switch OFF to avoid machine errors

**Always check `connectedTo`/`connectedFrom` to identify which on/off switch controls which path.**

## Disambiguating Modules with the Same Name

Multiple modules can share the same name (e.g., two `on/off` modules, two `note` modules). Use the `module_name:module_id` syntax:

```
module_name: "on/off:0.44105604671305754"
```

Get module IDs from `get_program_state` output.

## Checkbox Parameters

Checkboxes report `"value": "true"` or `"value": "false"` (not `"on"`/`"off"`).
To set a checkbox, use `value: "true"` to check or `value: "false"` to uncheck.

## Loading Input Files

Use the `load_file` tool to inject files into reader modules:

```
module_name: "read SVG"
file_path: "/absolute/path/to/board.svg"
```

This works with `read SVG`, `read png`, and any module that has a `type="file"` input. The file must be a local path on disk.

## Example: Complete PCB Milling Workflow

Here is the step-by-step sequence to mill a PCB and save the toolpath:

```
1. get_server_status              → confirm browser is connected
2. load_program                   → path: "programs/machines/Roland/SRM-20 mill/mill 2D PCB"
3. get_program_state              → identify all modules, find on/off switches
4. set_parameter                  → enable save file on/off switch (module_name: "on/off:<save-file-switch-id>", parameter: "", value: "true")
5. trigger_action                 → click preset: module_name: "set PCB defaults", action: "mill traces (1/64)"
6. load_file                      → module_name: "read SVG", file_path: "/path/to/board.svg"
7. trigger_action                 → module_name: "mill raster 2D", action: "calculate"
8. export_file                    → retrieve the generated .rml toolpath file
```

## Reading Program State Effectively

`get_program_state` returns rich information per module:

- **`id`**: Unique float ID for disambiguation
- **`name`**: Module display name
- **`params`**: Array of `{label, value, type}` — type is `text`, `checkbox`, `radio`, or `file`
- **`buttons`**: Array of clickable button labels
- **`connectedFrom`**: What feeds INTO this module — `[{from: "module name", fromId, port}]`
- **`connectedTo`**: What this module feeds — `[{to: "module name", toId, port}]`

Use `connectedTo`/`connectedFrom` to understand the data flow pipeline and identify gate switches.

## Available Program Categories

Use `list_programs` with category filter:
- `machines` — Roland mills, Epilog lasers, Prusa 3D printers, etc.
- `processes` — Generic image processing, mesh operations
- `image` — Image manipulation workflows
- `network` — Network-related programs

## Module Categories

Use `list_modules` with category filter:
- `read` — File readers (SVG, STL, PNG, etc.)
- `image` — Image processing (threshold, edge detect, etc.)
- `mesh` — 3D mesh operations
- `path/formats` — Toolpath format generators (G-code, RML, etc.)
- `ui` — UI elements (switch, label, note)
- `action` — Action modules (generate event, etc.)

## Sample Test Files

For testing PCB milling workflows:
- **SVG file**: https://fabacademy.org/2020/labs/ulb/students/quentin-bolsee/images/project_pcb_bezier/board.svg
- **Project docs**: https://fabacademy.org/2020/labs/ulb/students/quentin-bolsee/projects/pcb_bezier/
- **Description**: USB keyboard PCB with capacitive touch (SAMD11), designed in SVG PCB
- **Expected workflow**: Load in Roland SRM-20 "mill 2D PCB" program, process at 1000 DPI, generate RML toolpath
- **Machine used in original project**: Wegstr CNC with 45-degree mill for traces, 0.6mm flat end mill for clearance, 1mm for edge cuts

To use: download the SVG to `mods/board.svg`, then load it via the `read SVG` module.

## Tips

- Always call `get_program_state` after `load_program` to understand what you're working with
- Check on/off switches BEFORE triggering calculations
- The `trigger_action` tool waits 2 seconds for downloads after clicking — use `export_file` if you need to retrieve output later
- Parameter labels may be ambiguous (multiple `"mm:"` labels) — check surrounding context in the state output
- Some modules have preset buttons (like `set PCB defaults` with "mill traces (1/64)") that configure multiple parameters at once
