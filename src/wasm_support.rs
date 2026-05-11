use serde::Serialize;

/// Validate an f64 value from JavaScript before casting to u64.
/// Rejects NaN, infinity, negative values, non-integers, and values
/// above Number.MAX_SAFE_INTEGER (2^53 - 1) where f64 loses precision.
pub fn validate_f64_amount(value: f64, name: &str) -> Result<u64, String> {
    if !value.is_finite() {
        return Err(format!("{name} is not finite"));
    }
    if value < 0.0 {
        return Err(format!("{name} is negative"));
    }
    if value != value.floor() {
        return Err(format!("{name} is not an integer"));
    }
    if value > 9_007_199_254_740_991.0 {
        return Err(format!("{name} exceeds safe integer range"));
    }
    Ok(value as u64)
}

pub fn json_result<T: Serialize>(result: Result<T, String>) -> String {
    match result {
        Ok(data) => serde_json::json!({ "ok": true, "data": data }).to_string(),
        Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
    }
}

pub fn json_error(message: &str) -> String {
    serde_json::json!({ "ok": false, "error": message }).to_string()
}

pub fn base64_encode(input: &str) -> String {
    use std::fmt::Write;

    let bytes = input.as_bytes();
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut index = 0;
    while index + 2 < bytes.len() {
        let b0 = bytes[index] as usize;
        let b1 = bytes[index + 1] as usize;
        let b2 = bytes[index + 2] as usize;
        let _ = output.write_char(TABLE[b0 >> 2] as char);
        let _ = output.write_char(TABLE[((b0 & 3) << 4) | (b1 >> 4)] as char);
        let _ = output.write_char(TABLE[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
        let _ = output.write_char(TABLE[b2 & 0x3f] as char);
        index += 3;
    }

    match bytes.len() - index {
        1 => {
            let b0 = bytes[index] as usize;
            let _ = output.write_char(TABLE[b0 >> 2] as char);
            let _ = output.write_char(TABLE[(b0 & 3) << 4] as char);
            output.push_str("==");
        }
        2 => {
            let b0 = bytes[index] as usize;
            let b1 = bytes[index + 1] as usize;
            let _ = output.write_char(TABLE[b0 >> 2] as char);
            let _ = output.write_char(TABLE[((b0 & 3) << 4) | (b1 >> 4)] as char);
            let _ = output.write_char(TABLE[(b1 & 0xf) << 2] as char);
            output.push('=');
        }
        _ => {}
    }

    output
}

pub fn base64_decode(input: &str) -> Result<Vec<u8>, &'static str> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() * 3 / 4);

    const TABLE: [u8; 256] = {
        let mut table = [255u8; 256];
        let mut i = 0u8;
        while i < 26 {
            table[(b'A' + i) as usize] = i;
            table[(b'a' + i) as usize] = 26 + i;
            i += 1;
        }
        let mut i = 0u8;
        while i < 10 {
            table[(b'0' + i) as usize] = 52 + i;
            i += 1;
        }
        table[b'+' as usize] = 62;
        table[b'/' as usize] = 63;
        table[b'=' as usize] = 0;
        table
    };

    let mut index = 0;
    while index + 3 < bytes.len() {
        let (a, b, c, d) = (
            TABLE[bytes[index] as usize],
            TABLE[bytes[index + 1] as usize],
            TABLE[bytes[index + 2] as usize],
            TABLE[bytes[index + 3] as usize],
        );
        if a == 255 || b == 255 {
            return Err("invalid base64");
        }
        output.push((a << 2) | (b >> 4));
        if bytes[index + 2] != b'=' {
            if c == 255 {
                return Err("invalid base64");
            }
            output.push((b << 4) | (c >> 2));
        }
        if bytes[index + 3] != b'=' {
            if d == 255 {
                return Err("invalid base64");
            }
            output.push((c << 6) | d);
        }
        index += 4;
    }

    Ok(output)
}
