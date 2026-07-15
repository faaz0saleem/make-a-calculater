import unittest
from calculator import Calculator

class TestCalculator(unittest.TestCase):
    def test_add(self):
        calculator = Calculator()
        self.assertEqual(calculator.add(10, 5), 15)
        self.assertEqual(calculator.add(-1, 1), 0)
        self.assertEqual(calculator.add(-1, -1), -2)

    def test_subtract(self):
        calculator = Calculator()
        self.assertEqual(calculator.subtract(10, 5), 5)
        self.assertEqual(calculator.subtract(-1, 1), -2)
        self.assertEqual(calculator.subtract(-1, -1), 0)

    def test_multiply(self):
        calculator = Calculator()
        self.assertEqual(calculator.multiply(10, 5), 50)
        self.assertEqual(calculator.multiply(-1, 1), -1)
        self.assertEqual(calculator.multiply(-1, -1), 1)

    def test_divide(self):
        calculator = Calculator()
        self.assertEqual(calculator.divide(10, 2), 5)
        self.assertEqual(calculator.divide(-1, 1), -1)
        self.assertEqual(calculator.divide(-1, -1), 1)
        with self.assertRaises(ZeroDivisionError):
            calculator.divide(10, 0)

if __name__ == "__main__":
    unittest.main()
