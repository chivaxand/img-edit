// Load standalone core libraries first
import '~/libs/index';

// Load the core application framework (this ensures `App` is fully defined)
import { App } from '~/app';

// Load all plugins (they can now safely attach themselves to `App`)
import '~/actions/index';
import '~/filters/index';
import '~/tools/index';

// Initialize the application when the browser is ready
if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", () => {
        App.init();
    });
    
    // Fallback: Expose App to window if inline HTML onclicks exist
    (window as any).App = App;
}
