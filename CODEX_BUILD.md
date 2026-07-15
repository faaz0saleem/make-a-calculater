# 🤖 Hungter Codex build

**Task:** hi

**Mode:** fix  
**Language:** Python

## Files committed
- `index.html`
- `script.js`
- `app.py`
- `README.md`
- `tests/test_calculator.py`

## How it works

The existing project had several issues. The `app.py` file was using a list to store notes, but it wasn't using the `Database` class that was defined in `database.py`. This meant that the notes were not being persisted across different requests. 

The `calculator.py` file was correctly implementing the calculator operations, but it was raising a `ZeroDivisionError` when trying to divide by zero. This was a good practice, but the error was not being handled properly in the `app.py` file.

The `script.js` file was not making any API calls to the Flask server, so the notes were not being saved or retrieved from the server.

The fixes for these issues teach several important concepts:

1. **Separation of Concerns**: The `Database` class should be responsible for storing and retrieving data, while the `app.py` file should handle the API requests. This separation of concerns makes the code more organized and easier to maintain.
2. **Error Handling**: Properly handling errors, such as the `ZeroDivisionError`, is crucial to prevent the application from crashing. Instead, the application should return a meaningful error message to the user.
3. **API Calls**: Making API calls from the client-side JavaScript code to the server-side Flask API is essential for a web application to function correctly.

To try next:

1. **Implement User Authentication**: Add user authentication to the application, so that only authorized users can create, read, update, and delete notes.
2. **Use a Database**: Instead of using a list to store notes, use a real database like SQLite or MongoDB to persist the data across different requests.
