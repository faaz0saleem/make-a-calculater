const display = document.getElementById('display');
const buttons = document.querySelectorAll('button');

let currentNumber = '';
let previousNumber = '';
let operation = '';

buttons.forEach(button => {
    button.addEventListener('click', () => {
        const buttonId = button.id;

        if (buttonId === 'clear') {
            currentNumber = '';
            previousNumber = '';
            operation = '';
            display.value = '';
        } else if (buttonId === 'backspace') {
            currentNumber = currentNumber.slice(0, -1);
            display.value = currentNumber;
        } else if (buttonId === 'equals') {
            if (operation === 'add') {
                display.value = parseFloat(previousNumber) + parseFloat(currentNumber);
            } else if (operation === 'subtract') {
                display.value = parseFloat(previousNumber) - parseFloat(currentNumber);
            } else if (operation === 'multiply') {
                display.value = parseFloat(previousNumber) * parseFloat(currentNumber);
            } else if (operation === 'divide') {
                if (currentNumber !== '0') {
                    display.value = parseFloat(previousNumber) / parseFloat(currentNumber);
                } else {
                    display.value = 'Error';
                }
            }
            currentNumber = display.value;
            previousNumber = '';
            operation = '';
        } else if (buttonId === 'add' || buttonId === 'subtract' || buttonId === 'multiply' || buttonId === 'divide') {
            previousNumber = currentNumber;
            operation = buttonId;
            currentNumber = '';
            display.value = '';
        } else {
            currentNumber += button.textContent;
            display.value = currentNumber;
        }
    });
});
