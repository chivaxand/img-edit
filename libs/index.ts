import { fft } from './fft';
import { gif } from './gif';
import { image } from './image';
import { kernel } from './kernel';
import { plot } from './plot';
import { wavelet } from './wavelet';

export const Lib = { fft, gif, image, kernel, plot, wavelet };

// Bind to window for backward compatibility with filters not yet migrated
if (typeof window !== 'undefined') {
    (window as any).Lib = Lib;
}
