import { runLinalgTests } from './linalg-tests';
import { runImageTests } from './lib-image';

export interface TestRunner {
    test(name: string, fn: () => { pass: boolean; details?: any }): void;
}

export const Tests = {
    total: 0,
    failed: 0,
    passed: 0,

    test(name: string, fn: () => { pass: boolean; details?: any }) {
        this.total++;
        try {
            const result = fn();
            if (result.pass) {
                this.passed++;
                console.log(`%c✔ PASS: ${name}`, "color: #4caf50; font-weight: bold;");
            } else {
                this.failed++;
                console.groupCollapsed(`%c❌ FAIL: ${name}`, "color: #f44336; font-weight: bold;");
                console.log("Details:", result.details);
                console.groupEnd();
            }
        } catch (e) {
            this.failed++;
            console.groupCollapsed(`%c❌ ERROR: ${name}`, "color: #f44336; font-weight: bold;");
            console.error("Exception:", e);
            console.groupEnd();
        }
    },

    run() {
        this.total = 0;
        this.failed = 0;
        this.passed = 0;
        const startTime = performance.now();

        console.log("%cSTARTING TESTS", "font-size: 16px; font-weight: bold; border-bottom: 2px solid #333;");

        runLinalgTests(this);
        runImageTests(this);

        const elapsed = performance.now() - startTime;
        console.log("%c---------------------------------------", "color: #333;");

        if (this.failed > 0) {
            console.error(`%c❌ TESTS FAILED: ${this.failed} out of ${this.total} failed.`, "font-size: 16px; font-weight: bold;");
        } else {
            console.log(`%cALL TESTS PASSED: ${this.passed}/${this.total}`, "font-size: 16px; font-weight: bold; color: #4caf50;");
        }

        console.log(`%cTotal time: ${elapsed.toFixed(2)} ms`, "font-size: 14px; font-weight: bold; color: #2196f3;");
    }
};