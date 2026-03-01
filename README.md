# ScrollSnap

A browser-based tool that extracts screen content from an external PC via HDMI capture card.

**https://aidanpark.github.io/src-scroll-snap/**

[한국어](README.ko.md)

## The Problem

You need to transfer files or text from another computer (source PC) to yours (target PC), but face these constraints:

| Constraint | Detail |
|-----------|--------|
| No software installation on source PC | Nothing can be installed |
| No internet on source PC | No access to online tools or web pages |
| HDMI is the only transfer path | HDMI → Capture card → USB (one-way) |
| No reverse communication | Target PC cannot send feedback to source PC |
| **No file delivery to source PC** | No USB, network, or any other method to bring files to the source PC |
| **Keyboard input is the only input method** | Any code to run on source PC must be manually typed |
| Terminal available | cmd.exe, PowerShell accessible |
| Windows built-in tools only | PowerShell, .NET Framework, certutil, notepad, Edge, etc. |

In short, **the only things you can do on the source PC are type on the keyboard and look at the screen**.

## The Solution

Receive the HDMI output through a capture card and **grab exactly what's on the screen**.

```
Source PC (screen output) → HDMI → Capture Card (UVC) → USB → Target PC (browser app)
```

### Hardware

| Equipment | Role |
|-----------|------|
| HDMI capture card (UVC compatible) | Receives source PC screen via USB |
| USB 3.0 port | Connects capture card |
| HDMI cable | Connects source PC ↔ capture card |

### Software

| Component | Location | Description |
|-----------|----------|-------------|
| ScrollSnap web app | Target PC | Open a single HTML file in the browser. No server required |
| Windows built-in tools | Source PC | Only pre-installed tools (Notepad, PowerShell, etc.). No additional installation |

### Transfer Methods

| Target | Source PC Action | Target PC Processing |
|--------|-----------------|---------------------|
| **Text / Code** | Open file in a viewer and scroll | Screen capture → Image stitching → OCR text extraction |
| **Binary files** | Convert file to color grid pattern via PowerShell and display on screen | Screen capture → Color decoding → Original file restoration |

Text transfer requires **zero setup** on the source PC. Binary file transfer requires manually typing a PowerShell script on the source PC.

## Project Status

v0.2.6 — Block text detection, scroll capture, and file receive fully implemented.

## License

MIT License
