use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn roundtrip_benchmark(_c: &mut Criterion) {
    // TODO: Implement roundtrip benchmarks
}

criterion_group!(benches, roundtrip_benchmark);
criterion_main!(benches);
