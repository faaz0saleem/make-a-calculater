// ---------- Notes App ----------
const API_BASE = '';
const noteForm = document.getElementById('note-form');
const notesContainer = document.getElementById('notes-container');

// Escape user input before injecting into HTML to prevent XSS
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function fetchNotes() {
    try {
        const res = await fetch(`${API_BASE}/notes`);
        const notes = await res.json();
        renderNotes(notes);
    } catch (err) {
        console.error('Failed to load notes:', err);
    }
}

function renderNotes(notes) {
    notesContainer.innerHTML = '';
    notes.forEach((note) => {
        const noteElement = document.createElement('div');
        noteElement.classList.add('note');
        noteElement.innerHTML = `
            <h2 class="note-title">${escapeHtml(note.title)}</h2>
            <p class="note-content">${escapeHtml(note.content)}</p>
            <button class="delete-note" data-id="${note.id}">Delete</button>
        `;
        notesContainer.appendChild(noteElement);
    });

    document.querySelectorAll('.delete-note').forEach((button) => {
        button.addEventListener('click', async () => {
            const id = button.dataset.id;
            try {
                await fetch(`${API_BASE}/notes/${id}`, { method: 'DELETE' });
                fetchNotes();
            } catch (err) {
                console.error('Failed to delete note:', err);
            }
        });
    });
}

noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById('title');
    const contentInput = document.getElementById('content');
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
        return;
    }

    try {
        await fetch(`${API_BASE}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content }),
        });
        noteForm.reset();
        fetchNotes();
    } catch (err) {
        console.error('Failed to create note:', err);
    }
});

fetchNotes();

// ---------- Calculator App ----------
const calculatorForm = document.getElementById('calculator-form');
const calcResult = document.getElementById('calc-result');

calculatorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const num1 = document.getElementById('num1').value;
    const num2 = document.getElementById('num2').value;
    const operation = document.getElementById('operation').value;

    calcResult.textContent = '';
    calcResult.classList.remove('error');

    try {
        const res = await fetch(`${API_BASE}/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, num1, num2 }),
        });
        const data = await res.json();

        if (!res.ok) {
            calcResult.textContent = data.error || 'Something went wrong';
            calcResult.classList.add('error');
            return;
        }

        calcResult.textContent = `Result: ${data.result}`;
    } catch (err) {
        calcResult.textContent = 'Failed to reach the server';
        calcResult.classList.add('error');
        console.error('Calculator request failed:', err);
    }
});
