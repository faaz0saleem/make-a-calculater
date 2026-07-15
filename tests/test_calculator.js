const calculator = {
  add: (x, y) => x + y,
  subtract: (x, y) => x - y,
  multiply: (x, y) => x * y,
  divide: (x, y) => y === 0 ? Infinity : x / y,
};

describe('Calculator', () => {
  it('adds two numbers', () => {
    expect(calculator.add(2, 3)).toBe(5);
  });

  it('subtracts two numbers', () => {
    expect(calculator.subtract(5, 3)).toBe(2);
  });

  it('multiplies two numbers', () => {
    expect(calculator.multiply(4, 5)).toBe(20);
  });

  it('divides two numbers', () => {
    expect(calculator.divide(10, 2)).toBe(5);
  });

  it('handles division by zero', () => {
    expect(calculator.divide(10, 0)).toBe(Infinity);
  });
});
