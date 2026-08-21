use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use napi::{Env, Error, JsRangeError, JsTypeError, Result, Status};
use napi_derive::napi;

const MAX_PATTERN_LENGTH: usize = 64 * 1024;
const MAX_BRACE_EXPANSIONS: usize = 10_000;
const MAX_BRACE_DEPTH: usize = 1_000;

#[derive(Clone)]
struct PatternSegment {
    text: String,
    is_globstar: bool,
}

struct CompiledPattern {
    segs: Vec<PatternSegment>,
    min_segments: usize,
    has_globstar: bool,
}

struct CompiledGlob {
    negated: bool,
    has_slash: bool,
    alts: Vec<CompiledPattern>,
}

fn js_error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

fn throw_type_error(env: Env, message: impl Into<String>) -> Error {
    let error = Error::new(Status::InvalidArg, message.into());
    unsafe {
        JsTypeError::from(error).throw_into(env.raw());
    }
    Error::new(Status::PendingException, "")
}

fn throw_range_error(env: Env, message: impl Into<String>) -> Error {
    let error = Error::new(Status::InvalidArg, message.into());
    unsafe {
        JsRangeError::from(error).throw_into(env.raw());
    }
    Error::new(Status::PendingException, "")
}

fn find_brace_close(pattern: &str, open_idx: usize) -> Option<usize> {
    let bytes = pattern.as_bytes();
    let mut depth = 0usize;
    let mut i = open_idx;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn expand_braces(pattern: &str, out: &mut Vec<String>, depth: usize) -> bool {
    if depth > MAX_BRACE_DEPTH {
        return false;
    }

    let bytes = pattern.as_bytes();
    let mut open = None;
    let mut close = None;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'{' => {
                if let Some(found_close) = find_brace_close(pattern, i) {
                    open = Some(i);
                    close = Some(found_close);
                    break;
                }
            }
            _ => {}
        }
        i += 1;
    }

    let Some(open_idx) = open else {
        if out.len() >= MAX_BRACE_EXPANSIONS {
            return false;
        }
        out.push(pattern.to_string());
        return true;
    };
    let close_idx = close.expect("brace close must exist when open exists");

    let prefix = &pattern[..open_idx];
    let suffix = &pattern[close_idx + 1..];
    let mut alt_start = open_idx + 1;
    let mut nested = 0usize;
    let mut j = open_idx + 1;
    while j <= close_idx {
        let c = bytes[j];
        if c == b'\\' {
            j += 1;
        } else if c == b'{' {
            nested += 1;
        } else if c == b'}' && nested > 0 {
            nested -= 1;
        } else if (c == b',' && nested == 0) || j == close_idx {
            let alt = &pattern[alt_start..j];
            let expanded = format!("{prefix}{alt}{suffix}");
            if !expand_braces(&expanded, out, depth + 1) {
                return false;
            }
            alt_start = j + 1;
        }
        j += 1;
    }

    true
}

fn split_pattern_segments(pattern: &str) -> CompiledPattern {
    let bytes = pattern.as_bytes();
    let mut segs = Vec::new();
    let mut min_segments = 0usize;
    let mut has_globstar = false;
    let mut start = 0usize;

    for i in 0..=bytes.len() {
        if i == bytes.len() || bytes[i] == b'/' {
            let segment = &pattern[start..i];
            start = i + 1;
            let is_globstar = segment == "**";
            if is_globstar {
                has_globstar = true;
                if segs
                    .last()
                    .is_some_and(|seg: &PatternSegment| seg.is_globstar)
                {
                    continue;
                }
            } else {
                min_segments += 1;
            }
            segs.push(PatternSegment {
                text: segment.to_string(),
                is_globstar,
            });
        }
    }

    CompiledPattern {
        segs,
        min_segments,
        has_globstar,
    }
}

fn compile_glob(env: Env, raw: &str) -> Result<CompiledGlob> {
    if raw.len() > MAX_PATTERN_LENGTH {
        return Err(throw_range_error(
            env,
            format!("glob pattern is too long (limit: {MAX_PATTERN_LENGTH} bytes)"),
        ));
    }

    let bytes = raw.as_bytes();
    let mut negated = false;
    let mut start = 0usize;
    while start < bytes.len() && bytes[start] == b'!' {
        negated = !negated;
        start += 1;
    }

    let body = &raw[start..];
    let has_slash = body.contains('/');
    let mut expanded = Vec::new();
    if !expand_braces(body, &mut expanded, 0) {
        return Err(throw_range_error(
      env,
      format!(
        "glob pattern brace expansion is too large (limit: {MAX_BRACE_EXPANSIONS} alternatives, depth {MAX_BRACE_DEPTH})"
      ),
    ));
    }

    let alts = expanded
        .iter()
        .map(|pattern| split_pattern_segments(pattern))
        .collect();

    Ok(CompiledGlob {
        negated,
        has_slash,
        alts,
    })
}

fn parse_class(pattern: &[u8], open: usize) -> Option<(usize, usize, bool)> {
    let mut j = open + 1;
    let mut negated = false;
    if j < pattern.len() && (pattern[j] == b'!' || pattern[j] == b'^') {
        negated = true;
        j += 1;
    }
    let content_start = j;
    let mut k = j;
    if k < pattern.len() && pattern[k] == b']' {
        k += 1;
    }
    while k < pattern.len() {
        if pattern[k] == b'\\' {
            k += 1;
        } else if pattern[k] == b']' {
            return Some((content_start, k, negated));
        }
        k += 1;
    }
    None
}

fn read_class_member(pattern: &[u8], idx: &mut usize, close: usize) -> u8 {
    if pattern[*idx] == b'\\' && *idx + 1 < close {
        let c = pattern[*idx + 1];
        *idx += 2;
        c
    } else {
        let c = pattern[*idx];
        *idx += 1;
        c
    }
}

fn class_matches(pattern: &[u8], content_start: usize, close: usize, c: u8) -> bool {
    let mut matched = false;
    let mut m = content_start;
    while m < close {
        let mut lo_end = m;
        let lo = read_class_member(pattern, &mut lo_end, close);
        if lo_end < close && pattern[lo_end] == b'-' && lo_end + 1 < close {
            let mut hi_end = lo_end + 1;
            let hi = read_class_member(pattern, &mut hi_end, close);
            if lo <= c && c <= hi {
                matched = true;
            }
            m = hi_end;
        } else {
            if lo == c {
                matched = true;
            }
            m = lo_end;
        }
    }
    matched
}

fn match_one(pattern: &[u8], pi: usize, c: u8) -> (bool, usize) {
    match pattern[pi] {
        b'?' => (true, pi + 1),
        b'\\' => {
            if pi + 1 < pattern.len() {
                (pattern[pi + 1] == c, pi + 2)
            } else {
                (c == b'\\', pi + 1)
            }
        }
        b'[' => {
            if let Some((content_start, close, negated)) = parse_class(pattern, pi) {
                let matched = class_matches(pattern, content_start, close, c);
                (matched != negated, close + 1)
            } else {
                (c == b'[', pi + 1)
            }
        }
        pc => (pc == c, pi + 1),
    }
}

fn starts_with_dot(text: &str) -> bool {
    text.as_bytes().first() == Some(&b'.')
}

fn seg_can_match_dot(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    bytes.first() == Some(&b'.') || (bytes.first() == Some(&b'\\') && bytes.get(1) == Some(&b'.'))
}

fn seg_match(pattern: &str, text: &str, dot: bool) -> bool {
    if !dot && starts_with_dot(text) && !seg_can_match_dot(pattern) {
        return false;
    }

    let p = pattern.as_bytes();
    let t = text.as_bytes();
    let mut pi = 0usize;
    let mut ti = 0usize;
    let mut star_pi = None;
    let mut star_ti = 0usize;

    while ti < t.len() {
        if pi < p.len() {
            if p[pi] == b'*' {
                while pi < p.len() && p[pi] == b'*' {
                    pi += 1;
                }
                star_pi = Some(pi);
                star_ti = ti;
                continue;
            }

            let (matched, next_pi) = match_one(p, pi, t[ti]);
            if matched {
                pi = next_pi;
                ti += 1;
                continue;
            }
        }

        if let Some(resume_pi) = star_pi {
            star_ti += 1;
            ti = star_ti;
            pi = resume_pi;
            continue;
        }

        return false;
    }

    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

fn split_text_segments(text: &str) -> Vec<String> {
    text.split('/').map(ToString::to_string).collect()
}

fn match_pattern(pattern: &CompiledPattern, text_segments: &[String], dot: bool) -> bool {
    let p = pattern.segs.len();
    let t = text_segments.len();

    if pattern.min_segments > t {
        return false;
    }
    if !pattern.has_globstar && p != t {
        return false;
    }

    let mut next = vec![false; t + 1];
    let mut cur = vec![false; t + 1];
    next[t] = true;

    for ii in (0..p).rev() {
        let segment = &pattern.segs[ii];
        for jj in (0..=t).rev() {
            cur[jj] = if segment.is_globstar {
                let can_consume = jj < t && (dot || !starts_with_dot(&text_segments[jj]));
                next[jj] || (can_consume && cur[jj + 1])
            } else if jj < t {
                next[jj + 1] && seg_match(&segment.text, &text_segments[jj], dot)
            } else {
                false
            };
        }
        std::mem::swap(&mut cur, &mut next);
    }

    next[0]
}

fn match_compiled(glob: &CompiledGlob, text: &str, dot: bool) -> bool {
    let text_segments = split_text_segments(text);
    let matched = glob
        .alts
        .iter()
        .any(|pattern| match_pattern(pattern, &text_segments, dot));
    if glob.negated {
        !matched
    } else {
        matched
    }
}

fn can_descend_pattern(pattern: &CompiledPattern, dir_segments: &[String], dot: bool) -> bool {
    let p = pattern.segs.len();
    let t = dir_segments.len();

    if !pattern.has_globstar && p <= t {
        return false;
    }

    let mut next = vec![false; t + 1];
    let mut cur = vec![false; t + 1];

    for ii in (0..p).rev() {
        let segment = &pattern.segs[ii];
        cur[t] = true;
        for jj in (0..t).rev() {
            cur[jj] = if segment.is_globstar {
                let can_consume = dot || !starts_with_dot(&dir_segments[jj]);
                next[jj] || (can_consume && cur[jj + 1])
            } else {
                next[jj + 1] && seg_match(&segment.text, &dir_segments[jj], dot)
            };
        }
        std::mem::swap(&mut cur, &mut next);
    }

    next[0]
}

struct ScanState<'a> {
    glob: &'a CompiledGlob,
    exclude_dirs: &'a HashSet<String>,
    include_dot: bool,
    max_results: usize,
    results: Vec<String>,
    rel_prefix: String,
    dir_segments: Vec<String>,
}

struct ScanEntry {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

fn path_file_name(path: &Path) -> Option<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

fn scan_dir(dir: &Path, state: &mut ScanState) {
    if state.results.len() >= state.max_results {
        return;
    }

    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    let mut entries = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path_file_name(&path) else {
            continue;
        };

        if !state.include_dot && state.glob.negated && starts_with_dot(&name) {
            continue;
        }

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        let file_type = metadata.file_type();
        if file_type.is_dir() {
            entries.push(ScanEntry {
                name,
                path,
                is_dir: true,
            });
        } else if file_type.is_file() || file_type.is_symlink() {
            entries.push(ScanEntry {
                name,
                path,
                is_dir: false,
            });
        }
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    let can_prune = state.glob.has_slash && !state.glob.negated;

    for entry in entries {
        if state.results.len() >= state.max_results {
            return;
        }

        if entry.is_dir {
            if state.exclude_dirs.contains(&entry.name) {
                continue;
            }

            if can_prune {
                state.dir_segments.push(entry.name.clone());
                let descend = state.glob.alts.iter().any(|pattern| {
                    can_descend_pattern(pattern, &state.dir_segments, state.include_dot)
                });
                state.dir_segments.pop();
                if !descend {
                    continue;
                }
            } else if !state.include_dot && starts_with_dot(&entry.name) {
                continue;
            }

            let prev_len = state.rel_prefix.len();
            state.rel_prefix.push_str(&entry.name);
            state.rel_prefix.push('/');
            state.dir_segments.push(entry.name);

            scan_dir(&entry.path, state);

            state.dir_segments.pop();
            state.rel_prefix.truncate(prev_len);
        } else if state.glob.has_slash {
            let relative_path = format!("{}{}", state.rel_prefix, entry.name);
            if match_compiled(state.glob, &relative_path, state.include_dot) {
                state.results.push(relative_path);
            }
        } else if match_compiled(state.glob, &entry.name, state.include_dot) {
            state
                .results
                .push(format!("{}{}", state.rel_prefix, entry.name));
        }
    }
}

fn absolute_normalized(path: &str) -> std::io::Result<PathBuf> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(env::current_dir()?.join(path))
    }
}

#[napi(js_name = "globMatch")]
pub fn glob_match(env: Env, pattern: String, text: String, dot: Option<bool>) -> Result<bool> {
    let glob = compile_glob(env, &pattern)?;
    Ok(match_compiled(&glob, &text, dot.unwrap_or(false)))
}

#[napi(js_name = "globScan")]
pub fn glob_scan(
    env: Env,
    pattern: String,
    cwd: Option<String>,
    exclude_dirs: Option<Vec<String>>,
    dot: Option<bool>,
    max_results: Option<f64>,
) -> Result<Vec<String>> {
    let cwd_string = cwd.unwrap_or_else(|| ".".to_string());
    let include_dot = dot.unwrap_or(false);
    let max_results = match max_results {
        Some(value) if value.is_nan() || value < 0.0 => {
            return Err(throw_type_error(
                env,
                "maxResults must be a non-negative number",
            ));
        }
        Some(value) => value.floor().min(u32::MAX as f64) as usize,
        None => 1_000,
    };
    let glob = compile_glob(env, &pattern)?;

    let cwd_path = absolute_normalized(&cwd_string)
        .map_err(|_| js_error(format!("ENOENT: no such directory, scan '{cwd_string}'")))?;
    let metadata = fs::metadata(&cwd_path)
        .map_err(|_| js_error(format!("ENOENT: no such directory, scan '{cwd_string}'")))?;
    if !metadata.is_dir() {
        return Err(js_error(format!(
            "ENOTDIR: not a directory, scan '{cwd_string}'"
        )));
    }

    let exclude_dirs = exclude_dirs
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();
    let mut state = ScanState {
        glob: &glob,
        exclude_dirs: &exclude_dirs,
        include_dot,
        max_results,
        results: Vec::new(),
        rel_prefix: String::new(),
        dir_segments: Vec::new(),
    };
    scan_dir(&cwd_path, &mut state);
    Ok(state.results)
}
