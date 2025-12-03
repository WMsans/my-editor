import type { HostAPI } from "../../src-frontend/mod-engine/types";

export function activate(api: HostAPI) {
    let history: string[] = [];
    let currentIndex = -1;
    let isTraversing = false;

    // 1. Create Buttons in Top Bar
    const backBtn = api.window.createTopbarItem({
        id: 'nav-back',
        type: 'button',
        label: '←',
        tooltip: 'Go Back',
        width: '30px',
        disabled: true, // Start disabled
        onClick: () => goBack()
    });

    const nextBtn = api.window.createTopbarItem({
        id: 'nav-next',
        type: 'button',
        label: '→',
        tooltip: 'Go Forward',
        width: '30px',
        disabled: true, // Start disabled
        onClick: () => goNext()
    });

    const updateButtons = () => {
        backBtn.update({ disabled: currentIndex <= 0 });
        nextBtn.update({ disabled: currentIndex >= history.length - 1 });
    };
    
    // 2. Navigation Logic
    const goBack = () => {
        if (currentIndex > 0) {
            isTraversing = true;
            currentIndex--;
            const path = history[currentIndex];
            api.commands.executeCommand("file.open", path);
            updateButtons();
        }
    };

    const goNext = () => {
        if (currentIndex < history.length - 1) {
            isTraversing = true;
            currentIndex++;
            const path = history[currentIndex];
            api.commands.executeCommand("file.open", path);
            updateButtons();
        }
    };

    // 3. Listen to File Open Events
    api.events.on('file:open', (data: any) => {
        const path = data.path;
        if (!path) return;

        if (isTraversing) {
            // Flag reset handled here after event confirms navigation
            isTraversing = false;
        } else {
            // Standard navigation (User clicked a file)
            // If reloading the exact same file, ignore
            if (history[currentIndex] === path) return;

            // Truncate forward history if we navigated away from the middle
            if (currentIndex < history.length - 1) {
                history = history.slice(0, currentIndex + 1);
            }
            
            history.push(path);
            currentIndex++;
            updateButtons();
        }
    });
}

export function deactivate() {}