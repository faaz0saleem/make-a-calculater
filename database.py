class Database:
    def __init__(self):
        self.notes = []

    def create_note(self, title, content):
        note = Note(len(self.notes) + 1, title, content)
        self.notes.append(note)
        return note

    def get_all_notes(self):
        return self.notes

    def get_note(self, note_id):
        for note in self.notes:
            if note.id == note_id:
                return note
        return None

    def update_note(self, note_id, title=None, content=None):
        for note in self.notes:
            if note.id == note_id:
                if title:
                    note.title = title
                if content:
                    note.content = content
                return note
        return None

    def delete_note(self, note_id):
        for note in self.notes:
            if note.id == note_id:
                self.notes.remove(note)
                return True
        return False
