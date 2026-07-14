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
    result = calculator.calculate(operation, num1, num2)
    return jsonify({'result': result})

if __name__ == '__main__':
    app.run(debug=True)
