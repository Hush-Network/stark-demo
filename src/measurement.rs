use std::time::Duration;

pub fn duration_to_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

pub fn format_duration_ms(duration_ms: f64) -> String {
    if duration_ms >= 1.0 {
        format!("{duration_ms:.2}ms")
    } else {
        format!("{:.2}us", duration_ms * 1_000.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_duration_ms_uses_milliseconds_for_longer_values() {
        assert_eq!(format_duration_ms(12.3456), "12.35ms");
    }

    #[test]
    fn test_format_duration_ms_uses_microseconds_for_sub_ms_values() {
        assert_eq!(format_duration_ms(0.1275), "127.50us");
    }

    #[test]
    fn test_duration_to_ms_preserves_sub_ms_precision() {
        let duration = Duration::from_micros(375);
        assert!((duration_to_ms(duration) - 0.375).abs() < f64::EPSILON);
    }
}
