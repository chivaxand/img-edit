import { App, AppActions } from '~/app';

export const clipboardActions: Pick<AppActions, 'copy' | 'paste'> = {
    copy() {
        const l = App.utils.getActive();
        if (!l) return;

        const sel = App.state.selection;
        let clipData: any = null;

        // Case 1: An active selection mask exists on the current layer
        if (sel.active && sel.mask && sel.layerId === l.id) {
            const maskCanvas = sel.mask;
            const maskCtx = maskCanvas.getContext('2d')!;
            const w = maskCanvas.width;
            const h = maskCanvas.height;

            // Scan mask buffer to locate the bounding box of the active selection area
            const maskData = maskCtx.getImageData(0, 0, w, h).data;
            let minX = w, minY = h, maxX = 0, maxY = 0;
            let hasPixels = false;

            for (let y = 0; y < h; y++) {
                const yOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = (yOffset + x) * 4;
                    if (maskData[idx + 3] > 10) { // check alpha channel threshold
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                        hasPixels = true;
                    }
                }
            }

            if (!hasPixels) return; // Exit if selection holds no pixels

            const cropW = maxX - minX + 1;
            const cropH = maxY - minY + 1;

            // Render layer contents through the selection mask onto an intermediate canvas
            const maskedCanvas = document.createElement('canvas');
            maskedCanvas.width = l.canvas.width;
            maskedCanvas.height = l.canvas.height;
            const mCtx = maskedCanvas.getContext('2d')!;
            mCtx.drawImage(l.canvas, 0, 0);
            mCtx.save();
            mCtx.globalCompositeOperation = 'destination-in';
            mCtx.drawImage(maskCanvas, 0, 0);
            mCtx.restore();

            // Extract the cropped bounding box
            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = cropW;
            croppedCanvas.height = cropH;
            const cCtx = croppedCanvas.getContext('2d')!;
            cCtx.drawImage(maskedCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

            const scaleX = l.width / l.canvas.width;
            const scaleY = l.height / l.canvas.height;

            clipData = {
                canvas: croppedCanvas,
                width: cropW,
                height: cropH,
                displayW: cropW * scaleX,
                displayH: cropH * scaleY,
                offsetX: minX * scaleX + l.x,
                offsetY: minY * scaleY + l.y,
                name: `${l.name} (Cropped Copy)`
            };
        } else {
            // Case 2: Copy the entire active layer
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = l.canvas.width;
            tempCanvas.height = l.canvas.height;
            tempCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

            clipData = {
                canvas: tempCanvas,
                width: l.canvas.width,
                height: l.canvas.height,
                displayW: l.width,
                displayH: l.height,
                offsetX: l.x,
                offsetY: l.y,
                name: `${l.name} (Copy)`
            };
        }

        // Commit to internal application clipboard
        App.state.clipboard = clipData;

        // Attempt writing image directly to native system clipboard
        if (navigator.clipboard && navigator.clipboard.write) {
            clipData.canvas.toBlob((blob: Blob | null) => {
                if (blob) {
                    navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]).catch(err => console.warn('Native system clipboard write blocked:', err));
                }
            }, 'image/png');
        }
    },

    async paste(e?: ClipboardEvent) {
        let imageFile: File | null = null;

        // Try reading synchronous ClipboardEvent data (Ctrl+V context)
        if (e && e.clipboardData) {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    imageFile = items[i].getAsFile();
                    break;
                }
            }
        }

        // Fallback to async navigator.clipboard (such as triggering paste via Edit Menu click)
        if (!imageFile && !e && navigator.clipboard && navigator.clipboard.read) {
            try {
                const clipboardItems = await navigator.clipboard.read();
                for (const item of clipboardItems) {
                    for (const type of item.types) {
                        if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            imageFile = new File([blob], 'pasted-system-image.png', { type });
                            break;
                        }
                    }
                    if (imageFile) break;
                }
            } catch (err) {
                console.warn('System clipboard read denied, utilizing app clipboard buffer fallback:', err);
            }
        }

        if (imageFile) {
            // Case A: Creating a new layer from a native clipboard image file/blob
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    App.actions.saveState();
                    const newLayer = App.actions.createLayer(imageFile!.name || 'Pasted Layer', img);
                    if (newLayer) {
                        // Position pasted item centered on workspace
                        newLayer.x = Math.round((App.state.width - newLayer.width) / 2);
                        newLayer.y = Math.round((App.state.height - newLayer.height) / 2);
                        App.actions.addLayer(newLayer);
                        App.render();
                        App.ui.refreshLayers();
                    }
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(imageFile);
        } else if (App.state.clipboard) {
            // Case B: Pasting from internal app clipboard (retains original dimensions and visual offsets)
            App.actions.saveState();
            const clip = App.state.clipboard;
            const newLayer = App.actions.createLayer(clip.name, clip.canvas);
            if (newLayer) {
                newLayer.width = clip.displayW;
                newLayer.height = clip.displayH;
                newLayer.x = Math.round(clip.offsetX);
                newLayer.y = Math.round(clip.offsetY);

                App.actions.addLayer(newLayer);
                App.render();
                App.ui.refreshLayers();
            }
        }
    }
};