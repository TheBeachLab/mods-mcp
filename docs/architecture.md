# Architecture

C4 model documentation for the Mods MCP Server.

## Level 1: System Context

Shows how the MCP server fits into the broader ecosystem — who uses it and what external systems it depends on.

```mermaid
C4Context
    title System Context — Mods MCP Server

    Person(user, "User", "Operator, designer, or<br>Fab Lab user")
    System(llm_client, "LLM Client", "Claude Code, Claude Desktop,<br>or any MCP-compatible client")
    System(mcp_server, "Mods MCP Server", "Bridges LLMs to the Mods CE<br>digital fabrication platform<br>via browser automation")
    System_Ext(mods_ce, "Mods CE", "Browser-based visual programming<br>environment for digital fabrication")
    System_Ext(machine, "Fabrication Machine", "Roland SRM-20, Epilog laser,<br>Prusa 3D printer, etc.")

    Rel(user, llm_client, "Natural language<br>instructions")
    Rel(llm_client, mcp_server, "MCP tool calls<br>(stdio JSON-RPC)")
    Rel(mcp_server, mods_ce, "Browser automation<br>(Playwright CDP)")
    Rel(mods_ce, machine, "Toolpath via<br>WebUSB / file export")
```

## Level 2: Container Diagram

The MCP server process contains three main containers: the MCP protocol handler, an HTTP server, and a managed browser instance.

```mermaid
C4Container
    title Container Diagram — Mods MCP Server

    Person(llm, "LLM Client")

    System_Boundary(server_process, "MCP Server Process (Node.js)") {
        Container(mcp, "MCP Server", "McpServer + StdioTransport", "Registers 12 tools,<br>validates input with Zod,<br>routes to handlers")
        Container(http, "HTTP Server", "Node.js http.createServer", "Serves Mods CE static files<br>from mods/ submodule<br>on port 8080")
        Container(browser_mgr, "Browser Manager", "Playwright", "Launches Chrome,<br>manages page lifecycle,<br>intercepts downloads")
        ContainerDb(fs, "File System", "mods/ submodule", "Programs (53 JSON),<br>Modules (172 IIFE .js),<br>Static assets")
    }

    System_Ext(chrome, "Chrome Browser", "Runs Mods CE application")

    Rel(llm, mcp, "stdio JSON-RPC", "MCP protocol")
    Rel(mcp, browser_mgr, "load, interact, read state")
    Rel(mcp, fs, "list, read, parse modules")
    Rel(browser_mgr, chrome, "CDP (Chrome DevTools Protocol)")
    Rel(chrome, http, "HTTP GET", "Load Mods CE + programs")
    Rel(http, fs, "Read static files")
```

## Level 3: Component Diagram

Detailed view of the four source modules and how they collaborate.

```mermaid
C4Component
    title Component Diagram — Source Modules

    Container_Boundary(server_js, "server.js — Entry Point") {
        Component(cli, "CLI Parser", "Parses --port and --headless flags")
        Component(http_server, "HTTP Static Server", "Serves mods/ directory with MIME types")
        Component(mcp_server, "MCP Tool Registry", "12 tools with Zod schemas")
        Component(find_module, "findModule()", "Resolves module by name or name:id")
        Component(startup, "start()", "Orchestrates HTTP → Browser → MCP")
    }

    Container_Boundary(browser_js, "browser.js — Browser Automation") {
        Component(launch, "launch()", "Launches Chrome via Playwright,<br>waits for mods_prog_load")
        Component(load_prog, "loadProgram()", "Navigates to ?program= URL,<br>waits for DOM modules")
        Component(get_state, "getProgramState()", "Reads DOM modules + SVG links,<br>builds connection map")
        Component(set_input, "setModuleInput()", "Sets text/checkbox values,<br>dispatches change events")
        Component(click_btn, "clickModuleButton()", "Finds button by text,<br>clicks it")
        Component(set_file, "setModuleFile()", "Injects file via Playwright<br>setInputFiles()")
        Component(downloads, "Download Interceptor", "Captures Playwright download<br>events in memory")
        Component(extract, "extractProgramState()", "Replicates mods.js save_program()<br>reads #modules + #svg #links")
    }

    Container_Boundary(programs_js, "programs.js — Program Discovery") {
        Component(list_prog, "listPrograms()", "Recursive scan of<br>mods/programs/")
        Component(create_prog, "createProgram()", "Builds program JSON from<br>module paths + link specs")
        Component(save_prog, "saveProgram()", "Writes program JSON to<br>programs/custom/")
    }

    Container_Boundary(modules_js, "modules.js — Module Introspection") {
        Component(list_mod, "listModules()", "Recursive scan of<br>mods/modules/")
        Component(get_info, "getModuleInfo()", "Parses IIFE to extract<br>name, inputs, outputs")
        Component(vm_sandbox, "extractWithVm()", "Node.js vm sandbox with<br>DOM mocks (172/172 success)")
        Component(regex_fb, "extractWithRegex()", "Regex fallback for<br>var name/inputs/outputs")
    }

    Rel(mcp_server, find_module, "resolves modules")
    Rel(find_module, get_state, "gets current state")
    Rel(mcp_server, launch, "start browser")
    Rel(mcp_server, load_prog, "load program")
    Rel(mcp_server, get_state, "read state")
    Rel(mcp_server, set_input, "set parameters")
    Rel(mcp_server, click_btn, "trigger actions")
    Rel(mcp_server, set_file, "load files")
    Rel(mcp_server, downloads, "export files")
    Rel(mcp_server, extract, "save program")
    Rel(mcp_server, list_prog, "list programs")
    Rel(mcp_server, create_prog, "create programs")
    Rel(mcp_server, save_prog, "save programs")
    Rel(mcp_server, list_mod, "list modules")
    Rel(mcp_server, get_info, "get module info")
    Rel(get_info, vm_sandbox, "primary parser")
    Rel(get_info, regex_fb, "fallback parser")
```

## Sequence Diagram: PCB Milling Workflow

Shows the complete data flow when an LLM generates a PCB toolpath.

```mermaid
sequenceDiagram
    participant LLM as LLM Client
    participant MCP as MCP Server
    participant PW as Playwright
    participant Chrome as Chrome Browser
    participant Mods as Mods CE (DOM)
    participant HTTP as HTTP Server
    participant FS as File System

    Note over LLM, FS: 1. Startup
    MCP->>HTTP: Listen on port 8080
    MCP->>FS: Serve mods/ directory
    MCP->>PW: Launch Chrome
    PW->>Chrome: Open browser
    Chrome->>HTTP: GET /index.html
    HTTP->>FS: Read mods/index.html
    FS-->>HTTP: HTML + JS + CSS
    HTTP-->>Chrome: Mods CE application
    Chrome->>Mods: Initialize mods.js

    Note over LLM, FS: 2. Load Program
    LLM->>MCP: load_program("...SRM-20 mill/mill 2D PCB")
    MCP->>PW: loadProgram()
    PW->>Chrome: Navigate to ?program=...
    Chrome->>HTTP: GET program JSON
    HTTP->>FS: Read program file
    FS-->>HTTP: JSON with module definitions
    HTTP-->>Chrome: Program JSON
    Chrome->>Mods: eval() module IIFEs, build UI
    PW-->>MCP: DOM modules ready
    MCP-->>LLM: Module list + IDs

    Note over LLM, FS: 3. Inspect & Configure
    LLM->>MCP: get_program_state()
    MCP->>PW: getProgramState()
    PW->>Chrome: page.evaluate()
    Chrome->>Mods: Read #modules + #svg #links
    Mods-->>Chrome: Module params, buttons, connections
    Chrome-->>PW: State JSON
    PW-->>MCP: State with connectedTo/connectedFrom
    MCP-->>LLM: Full pipeline topology

    LLM->>MCP: set_parameter("on/off:0.441...", "", "true")
    MCP->>PW: setModuleInput()
    PW->>Chrome: Set checkbox.checked = true
    MCP-->>LLM: Success

    LLM->>MCP: trigger_action("set PCB defaults", "mill traces (1/64)")
    MCP->>PW: clickModuleButton()
    PW->>Chrome: button.click()
    Chrome->>Mods: Apply preset parameters
    MCP-->>LLM: Clicked

    Note over LLM, FS: 4. Load Input & Calculate
    LLM->>MCP: load_file("read SVG", "/path/to/board.svg")
    MCP->>PW: setModuleFile()
    PW->>Chrome: setInputFiles(board.svg)
    Chrome->>Mods: FileReader → svg_load_handler → outputs.SVG.event()
    Mods->>Mods: SVG → convert → threshold → distance → offset → edge → vectorize

    LLM->>MCP: trigger_action("mill raster 2D", "calculate")
    MCP->>PW: clickModuleButton()
    PW->>Chrome: button.click()
    Chrome->>Mods: Calculate toolpath
    Mods->>Mods: path → mill raster 2D → view toolpath → Roland SRM-20 → on/off → save file
    Chrome-->>PW: Download event (SVG image.rml)
    PW->>PW: Capture download in memory
    MCP-->>LLM: Success + download info

    Note over LLM, FS: 5. Export
    LLM->>MCP: export_file()
    MCP->>PW: getLatestDownload()
    PW-->>MCP: RML file content (69KB)
    MCP-->>LLM: Toolpath data
```

## Data Flow: Mods CE Internal Pipeline

How data flows through a typical PCB milling program inside the Mods CE browser.

```mermaid
flowchart LR
    subgraph Input
        SVG[read SVG]
        PNG[read png]
    end

    subgraph "Image Processing"
        CONVERT[convert SVG image<br>1000 DPI]
        THRESH[image threshold<br>0-1]
        DIST[distance transform]
        OFFSET[offset]
        EDGE[edge detect]
        ORIENT[orient edges]
        VEC[vectorize]
    end

    subgraph "Toolpath Generation"
        MILL[mill raster 2D<br>calculate]
        VIEW[view toolpath]
        DEFAULTS[set PCB defaults]
        VBIT[V-bit calculator]
    end

    subgraph "Machine Output"
        MACHINE[Roland SRM-20<br>milling machine]
        RML[Roland SRM-20 RML<br>format converter]
    end

    subgraph "Output Gates"
        SW_USB[on/off<br>DEFAULT: ON]
        SW_FILE[on/off<br>DEFAULT: OFF]
        USB[WebUSB]
        SAVE[save file]
    end

    SVG --> CONVERT --> THRESH --> DIST --> OFFSET --> EDGE --> ORIENT --> VEC --> MILL
    PNG --> THRESH
    CONVERT -.->|imageInfo| MILL
    PNG -.->|imageInfo| MILL
    DEFAULTS -->|settings| MILL
    VBIT -->|settings| MILL
    MILL -->|toolpath| VIEW --> MACHINE
    MILL -.->|offset| OFFSET
    MACHINE -->|file| SW_USB --> USB
    MACHINE -->|file| SW_FILE --> SAVE

    style SW_USB fill:#4CAF50,color:#fff
    style SW_FILE fill:#f44336,color:#fff
    style USB fill:#FFB74D
    style SAVE fill:#FFB74D
```

## Key Design Decisions

### Why Playwright instead of direct DOM manipulation?

Mods CE was designed as a standalone browser application. Its core runtime (`mods.js`) uses closures, `eval()`, and direct DOM manipulation that make it impossible to run in Node.js. Playwright lets us control the real application exactly as a human would, while also providing:

- **Download interception** for capturing generated toolpath files
- **File input injection** via `setInputFiles()` for loading SVG/PNG designs
- **JavaScript evaluation** for reading DOM state and triggering events
- **Page navigation** for loading different programs

### Why a vm sandbox for module parsing?

Module IIFE source files define their inputs/outputs inside closures. Simple regex extraction misses complex cases (computed types, conditional ports). The Node.js `vm` module lets us evaluate each IIFE in an isolated sandbox with minimal DOM mocks, achieving 100% parse rate (172/172 modules) without executing any browser-dependent code.

### Why double-stringified links?

This is a Mods CE design choice, not ours. Program JSON stores connections as an array of JSON strings, where each string parses to an object whose `source` and `dest` fields are themselves JSON strings. Three levels of parsing are needed. Our `extractProgramState()` and `createProgram()` functions handle this encoding transparently.

### Why connection topology in get_program_state?

The original state only showed module names, parameters, and buttons — with no indication of how modules connect. This made it impossible for an LLM to distinguish between two `on/off` switches or understand the data flow. By parsing the SVG link elements, we expose `connectedTo` and `connectedFrom` on each module, enabling the LLM to reason about the pipeline.
