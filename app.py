from flask import Flask, request, jsonify
from calculator import Calculator

app = Flask(__name__)
calculator = Calculator()

# Notes endpoint
notes = []

# Create a note
@app.route('/notes', methods=['POST'])
def create_note():
    data = request.get_json()
    if 'title' not in data or 'content' not in data:
        return jsonify({'error': 'Title and content are required'}), 400
    note = {
        'id': len(notes) + 1,
        'title': data['title'],
        'content': data['content']
    }
    notes.append(note)
    return jsonify(note), 201

# Get all notes
@app.route('/notes', methods=['GET'])
def get_all_notes():
    return jsonify(notes)

# Get a note by id
@app.route('/notes/<int:note_id>', methods=['GET'])
def get_note(note_id):
    for note in notes:
        if note['id'] == note_id:
            return jsonify(note)
    return jsonify({'error': 'Note not found'}), 404

# Update a note
@app.route('/notes/<int:note_id>', methods=['PUT'])
def update_note(note_id):
    for note in notes:
        if note['id'] == note_id:
            data = request.get_json()
            if 'title' in data:
                note['title'] = data['title']
            if 'content' in data:
                note['content'] = data['content']
            return jsonify(note)
    return jsonify({'error': 'Note not found'}), 404

# Delete a note
@app.route('/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    for note in notes:
        if note['id'] == note_id:
            notes.remove(note)
            return jsonify({'message': 'Note deleted'})
    return jsonify({'error': 'Note not found'}), 404

# Calculator endpoint
@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.get_json()
    operation = data.get('operation')
    num1 = data.get('num1')
    num2 = data.get('num2')
    
    if operation not in ['add', 'subtract', 'multiply', 'divide']:
        return jsonify({'error': 'Invalid operation'}), 400
    
    try:
        num1 = float(num1)
        num2 = float(num2)
    except ValueError:
        return jsonify({'error': 'Invalid input'}), 400
    
    if operation == 'add':
        result = calculator.add(num1, num2)
    elif operation == 'subtract':
        result = calculator.subtract(num1, num2)
    elif operation == 'multiply':
        result = calculator.multiply(num1, num2)
    elif operation == 'divide':
        if num2 == 0:
            return jsonify({'error': 'Cannot divide by zero'}), 400
        result = calculator.divide(num1, num2)
    
    return jsonify({'result': result})

if __name__ == '__main__':
    app.run(debug=True)
