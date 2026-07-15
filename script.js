const noteForm = document.getElementById('note-form');
const notesContainer = document.getElementById('notes-container');

let notes = [];

noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('title').value;
    const content = document.getElementById('content').value;
    const note = { title, content };
    notes.push(note);
    renderNotes();
    noteForm.reset();
});

function renderNotes() {
    notesContainer.innerHTML = '';
    notes.forEach((note, index) => {
        const noteElement = document.createElement('div');
        noteElement.classList.add('note');
        noteElement.innerHTML = `
            <h2 class="note-title">${note.title}</h2>
            <p class="note-content">${note.content}</p>
            <button class="delete-note" data-index="${index}">Delete</button>
        `;
        notesContainer.appendChild(noteElement);
    });
    const deleteButtons = document.querySelectorAll('.delete-note');
    deleteButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const index = button.dataset.index;
            notes.splice(index, 1);
            renderNotes();
        });
    });
}
