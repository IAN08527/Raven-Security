use std::process::Command;

fn main() {
    println!("[sidecar] Raven Intelligence Engine launcher starting...");
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut cmd = Command::new("python");
    cmd.arg("main.py");
    cmd.args(&args);
    
    // If running in engine folder
    if std::path::Path::new("main.py").exists() {
        let _ = cmd.status();
    } else if std::path::Path::new("engine/main.py").exists() {
        let mut c = Command::new("python");
        c.current_dir("engine");
        c.arg("main.py");
        c.args(&args);
        let _ = c.status();
    } else {
        let mut c = Command::new("python");
        c.current_dir("../engine");
        c.arg("main.py");
        c.args(&args);
        let _ = c.status();
    }
}
