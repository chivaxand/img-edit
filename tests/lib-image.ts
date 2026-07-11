import { image } from '../libs/image';
import { TestRunner } from './index';

export function runImageTests(runner: TestRunner) {
    const { padTo2D, convolve1d } = image;

    // Delegate testing execution and logging to global runner
    function test({ name, actual, expected, epsilon = 0.0001 }: { name: string, actual: any, expected: number[], epsilon?: number }) {
        runner.test(name, () => {
            const flatActual = (actual.length > 0 && (actual[0] instanceof Float32Array || Array.isArray(actual[0])))
                ? actual.reduce((acc: number[], row: number[] | Float32Array) => [...acc, ...Array.from(row)], [])
                : Array.from(actual);
                
            let pass = flatActual.length === expected.length;
            if (pass) {
                for (let i = 0; i < flatActual.length; i++) {
                    if (Math.abs(flatActual[i] - expected[i]) > epsilon) {
                        pass = false;
                        break;
                    }
                }
            }
            return { pass, details: { expected, actual: flatActual } };
        });
    }

    // ==========================================
    // padTo2D
    // ==========================================
    console.group("Testing padTo2D");

    test({
        name: "Standard: Constant Padding (Centering)",
        actual: padTo2D([1, 2], 2, 1, 4, 3, 'constant'),
        expected: [0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0]
    });

    test({
        name: "Extreme: Symmetric Padding > Image Size",
        actual: padTo2D([1, 2], 2, 1, 10, 1, 'symmetric'),
        expected: [1, 2, 2, 1, 1, 2, 2, 1, 1, 2]
    });

    test({
        name: "Extreme: Reflect Padding > Image Size",
        actual: padTo2D([1, 2, 3], 3, 1, 11, 1, 'reflect'),
        expected: [1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3]
    });

    console.groupEnd();

    // ==========================================
    // convolve1d
    // ==========================================
    console.group("Testing convolve1d");

    const img = new Float32Array([10, 20, 30]);

    test({
        name: "Standard: Horizontal Identity",
        actual: convolve1d(img, 3, 1, [0, 1, 0], false),
        expected: [10, 20, 30]
    });

    test({
        name: "Standard: Shift Right (Reads Left)",
        actual: convolve1d(img, 3, 1, [1, 0, 0], false, 'constant'),
        expected: [0, 10, 20]
    });

    test({
        name: "Extreme: Kernel > Image (Symmetric/RepeatEdge)",
        actual: convolve1d(new Float32Array([10, 20]), 2, 1, [1, 0, 0, 0, 0, 0, 0], false, 'symmetric'),
        expected: [20, 20]
    });

    test({
        name: "Extreme: Kernel > Image (Reflect/Mirror)",
        actual: convolve1d(new Float32Array([10, 20]), 2, 1, [1, 0, 0, 0, 0, 0, 0], false, 'reflect'),
        expected: [20, 10]
    });

    test({
        name: "Extreme: Wrap Mode (Full Period)",
        actual: convolve1d(new Float32Array([1, 2, 3]), 3, 1, [1, 0, 0, 0, 0, 0, 0], false, 'wrap'),
        expected: [1, 2, 3]
    });

    test({
        name: "Vertical: Wrap Mode",
        actual: convolve1d(new Float32Array([1, 2, 3, 4]), 2, 2, [1, 0, 0], true, 'wrap'),
        expected: [3, 4, 1, 2]
    });

    console.groupEnd();
}