# Appwave

A web-based agentic coding experience for building apps for iOS and Android platforms.

Describe what you want to build in plain language, and let AI agents handle the code generation, project configuration, and complexity for you.

## Features

- **AI-Powered Development** - Describe your app and watch AI write native Swift and Kotlin code
- **iOS & Android Support** - Build for both platforms from a single workflow
- **Web-Based Interface** - No IDE required, access from any browser
- **Local-First** - Your code stays on your machine
- **Open Source** - Built with Rust and Tauri, MIT licensed

## Getting Started

### Prerequisites

Install dependencies with [mise](https://mise.jdx.dev/):

```bash
mise install
```

Or manually install:
- Rust (via [rustup](https://rustup.rs/))
- Node.js 22+
- pnpm

### Running the Desktop App

```bash
cargo tauri dev
```

This starts a menu bar app that opens the Appwave interface in your browser.

### Running the CLI (headless)

```bash
cargo run -p appwave-cli
```

Then open http://localhost:4000

## Architecture

```
Appwave/
├── appwave-core/       # Shared library (Axum server, SQLite, config)
├── appwave-cli/        # Standalone CLI server
├── src-tauri/          # Tauri desktop app (system tray)
└── marketing/          # Eleventy marketing website
```

### Components

| Component | Description |
|-----------|-------------|
| **appwave-core** | HTTP server (Axum), SQLite database, configuration |
| **appwave-cli** | Standalone CLI to run the server without GUI |
| **src-tauri** | Tauri desktop app with system tray integration |
| **marketing** | Eleventy-based marketing website |

## Marketing Website

The marketing site is built with [Eleventy](https://www.11ty.dev/).

```bash
cd marketing
pnpm install
pnpm dev      # Development server
pnpm build    # Production build
```

## Configuration

Configuration is stored at:
- **macOS**: `~/Library/Application Support/ai.appwave.Appwave/`
- **Linux**: `~/.config/appwave/`
- **Windows**: `%APPDATA%\appwave\`

## Building for Production

```bash
cargo tauri build
```

## License

MIT License. See [LICENSE](LICENSE) for details.
