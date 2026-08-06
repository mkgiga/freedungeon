// The console is the product problem we're solving, so don't ship one.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The backend, baked in at compile time by server/build.ts.
///
/// Embedded rather than shipped beside the exe so distribution stays a single
/// file. It is written out on first run because it must be a real process:
/// the backend is a Bun binary with its own embedded assets, not something
/// this shell can host in-process.
const BACKEND: &[u8] = include_bytes!(env!("FREEDUNGEON_BACKEND"));

/// Bumped whenever the embedded backend changes, so an upgraded shell replaces
/// a stale extracted copy instead of running last version's server.
const BACKEND_STAMP: &str = env!("FREEDUNGEON_BACKEND_STAMP");

/// Where the app keeps everything. Mirrors server/src/paths.ts — the backend
/// computes this independently, so the two must agree.
fn data_dir() -> PathBuf {
    std::env::var_os("FREEDUNGEON_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs_home().map(|h| h.join(".freedungeon")))
        .expect("no home directory")
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Write the embedded backend out, unless an identical copy is already there.
///
/// Keyed on a stamp rather than a plain existence check: a half-written file
/// from a killed first run, or last version's binary, both "exist". Written to
/// a temp name and renamed so a crash mid-write can't leave a truncated exe
/// that looks complete — the same rule the dependency downloader follows.
fn extract_backend() -> std::io::Result<PathBuf> {
    let dir = data_dir().join("bin");
    std::fs::create_dir_all(&dir)?;

    let exe = dir.join(if cfg!(windows) { "freedungeon.exe" } else { "freedungeon" });
    let stamp = dir.join("backend.stamp");

    let current = std::fs::read_to_string(&stamp).unwrap_or_default();
    if exe.exists() && current == BACKEND_STAMP {
        return Ok(exe);
    }

    let partial = dir.join("freedungeon.partial");
    {
        let mut f = std::fs::File::create(&partial)?;
        f.write_all(BACKEND)?;
        f.sync_all()?;
    }

    // Windows refuses to replace a running image; if a previous instance is
    // still alive the rename fails and the existing binary is fine to reuse.
    if let Err(err) = std::fs::rename(&partial, &exe) {
        let _ = std::fs::remove_file(&partial);
        if !exe.exists() {
            return Err(err);
        }
        return Ok(exe);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755))?;
    }

    std::fs::write(&stamp, BACKEND_STAMP)?;
    Ok(exe)
}

/// Find a base port with its two neighbours free.
///
/// The backend needs three: HTTP, socket.io, and the agent. They have to be
/// consecutive because the client derives the socket port from the one it was
/// served on, so they can't be picked independently.
fn find_port_triple() -> Option<u16> {
    let probe = |port: u16| {
        TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok()
    };
    // Start from the documented defaults so a normal run looks familiar in
    // logs and firewall prompts, then walk upward.
    (8078..8178).step_by(3).find(|&base| {
        probe(base) && probe(base + 1) && probe(base + 2)
    })
}

fn spawn_backend(exe: &Path, base: u16) -> std::io::Result<Child> {
    let mut cmd = Command::new(exe);
    cmd.env("FREEDUNGEON_PORT", base.to_string())
        .env("FREEDUNGEON_WS_PORT", (base + 1).to_string())
        .env("AGENT_PORT", (base + 2).to_string())
        // Every interface, so a phone or tablet on the same network can open
        // the same session — the client already derives its host and socket
        // port from wherever the page was served, so LAN just works.
        //
        // The cost is Windows Firewall's "allow on public networks?" prompt on
        // first launch. Exposure is still bounded: the server 403s any request
        // whose source isn't a private-range address (see initHttp).
        //
        // Overridable — set FREEDUNGEON_HOST=127.0.0.1 before launching to keep
        // it loopback-only and avoid the prompt entirely.
        .env(
            "FREEDUNGEON_HOST",
            std::env::var("FREEDUNGEON_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
        );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The backend is still a console binary so it stays usable from a
        // terminal (--help, --data-dir). CREATE_NO_WINDOW keeps that console
        // from appearing when the shell launches it — which is also what
        // removes the QuickEdit freeze, since there's no window to click.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
}

/// Block until the backend answers, so the window never shows a dead page.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Kill the backend *and* its children.
///
/// The backend spawns the Claude agent by re-execing itself, and on Windows
/// killing a process does not run its handlers — so a plain kill() strands the
/// agent holding its port and the next launch picks a different triple, or
/// worse, collides. taskkill /T takes the tree down.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

struct Backend(Mutex<Option<Child>>);

fn main() {
    let exe = match extract_backend() {
        Ok(p) => p,
        Err(err) => {
            fatal(&format!("Could not unpack the server:\n{err}"));
            return;
        }
    };

    let Some(base) = find_port_triple() else {
        fatal("No free ports available in 8078-8178.");
        return;
    };

    let child = match spawn_backend(&exe, base) {
        Ok(c) => c,
        Err(err) => {
            fatal(&format!("Could not start the server:\n{err}"));
            return;
        }
    };

    let backend = Backend(Mutex::new(Some(child)));

    tauri::Builder::default()
        .manage(backend)
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{base}");
            // Show the splash immediately, then swap to the real client once
            // the port answers — a blank window while Bun boots reads as a hang.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("freedungeon")
                .inner_size(1280.0, 860.0)
                .min_inner_size(360.0, 480.0)
                .build()?;

            std::thread::spawn(move || {
                if wait_for_port(base, Duration::from_secs(60)) {
                    let _ = window.navigate(url.parse().expect("valid url"));
                } else {
                    let _ = window.eval(
                        "document.body.innerHTML = '<p>The server did not start. \
                         See ~/.freedungeon for logs.</p>'",
                    );
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        kill_tree(&mut child);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start");
}

/// Last-resort error surface. With no console there is nowhere else to say it.
fn fatal(message: &str) {
    #[cfg(windows)]
    {
        let script = format!(
            "Add-Type -AssemblyName PresentationFramework; \
             [System.Windows.MessageBox]::Show('{}', 'freedungeon')",
            message.replace('\'', "''").replace('\n', " ")
        );
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    eprintln!("{message}");
}
