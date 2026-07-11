// Load standalone core libraries first
import '~/libs/index';

// Load core application framework
import { App } from '~/app';

// Load plugins
import '~/actions/index';
import '~/filters/index';
import '~/tools/index';

// Load testing suites
import { Tests } from '~/tests/index';

// Initialize the application when the browser is ready
if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", () => {
        App.init();
    });
    
    // Expose globally for console debugging
    (window as any).App = App;
    (window as any).Tests = Tests;
}