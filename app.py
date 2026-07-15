from flask import Flask, request, jsonify
from calculator import Calculator

app = Flask(__name__)
calculator = Calculator()

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
