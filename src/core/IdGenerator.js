let counters = {};

export function generateId(prefix = 'id') {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${Date.now().toString(36)}_${counters[prefix]}`;
}

export function resetIdCounters() {
    counters = {};
}
