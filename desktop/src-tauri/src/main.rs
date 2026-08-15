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

/// The backend's three ports — HTTP, socket.io, and the agent RPC.
///
/// Fixed, and identical to the CLI's defaults, so the desktop app and a
/// terminal run behave the same and appear the same in logs, firewall prompts
/// and bug reports. The client derives its socket port as "served port + 1",
/// which is why the first two are adjacent.
///
/// This used to scan 8078-8178 for three consecutive free ports. That traded a
/// knowable port for an unknowable one and still failed: the whole window is
/// barely wider than the 100-port blocks Windows' Host Network Service reserves
/// for Hyper-V/WSL/Docker, so a single reservation landing anywhere in it wiped
/// out every candidate at once. A fixed port that occasionally collides is
/// easier to reason about — and to explain to a user — than a moving one.
const HTTP_PORT: u16 = 8078;
const WS_PORT: u16 = 8079;
const AGENT_PORT: u16 = 8076;

/// Read a port override from our own environment, as with FREEDUNGEON_HOST.
fn port_env(key: &str, default: u16) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Check one port is bindable, and say precisely why if it isn't.
///
/// Not a search — there is nowhere else to go. This exists purely so a
/// collision is reported in the first second with a cause, instead of the
/// backend dying quietly and the shell sitting on a splash screen for the full
/// 60-second timeout before saying "the server did not start".
///
/// `PermissionDenied` is the one worth naming. On Windows it means WSAEACCES:
/// the port is in a reserved exclusion range, so nothing is listening and
/// netstat shows it free, yet bind is refused. Without saying so, the only
/// visible symptom points at a conflict that doesn't exist.
fn check_port(port: u16, role: &str) -> Result<(), String> {
    match TcpListener::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port)) {
        Ok(_) => Ok(()),
        Err(err) => Err(match err.kind() {
            std::io::ErrorKind::PermissionDenied => format!(
                "Port {port} ({role}) is reserved by Windows, so nothing can bind it                  even though it looks free.

                 Check with:
                   netsh interface ipv4 show excludedportrange protocol=tcp

                 These reservations are taken from the TCP dynamic port range. If that                  range starts below 49152, restoring the default stops them landing on                  ports like this one — in an admin prompt:
                   netsh int ipv4 set dynamicport tcp start=49152 num=16384
                   netsh int ipv6 set dynamicport tcp start=49152 num=16384

                 Then reboot."
            ),
            std::io::ErrorKind::AddrInUse => format!(
                "Port {port} ({role}) is already in use — most likely another copy of                  freedungeon is running. Close it and try again."
            ),
            _ => format!("Port {port} ({role}) is unavailable: {err}"),
        }),
    }
}

fn spawn_backend(exe: &Path, http: u16, ws: u16, agent: u16) -> std::io::Result<Child> {
    let mut cmd = Command::new(exe);
    cmd.env("FREEDUNGEON_PORT", http.to_string())
        .env("FREEDUNGEON_WS_PORT", ws.to_string())
        .env("AGENT_PORT", agent.to_string())
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
/// agent holding its port, and since the ports are fixed the next launch has
/// nowhere else to go and refuses to start. taskkill /T takes the tree down.
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

    let base = port_env("FREEDUNGEON_PORT", HTTP_PORT);
    let ws = port_env("FREEDUNGEON_WS_PORT", WS_PORT);
    let agent = port_env("AGENT_PORT", AGENT_PORT);

    for (port, role) in [(base, "web"), (ws, "live updates"), (agent, "agent")] {
        if let Err(msg) = check_port(port, role) {
            fatal(&msg);
            return;
        }
    }

    let child = match spawn_backend(&exe, base, ws, agent) {
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
