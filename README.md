# Advanced RAG AI Chatbot

Website Link - https://chatbot-frontend-mjah.onrender.com/

## Overview

This is a full-stack chatbot that uses **Retrieval-Augmented Generation
(RAG)** to provide intelligent, context-aware responses. It features a
**React frontend** and a **Python FastAPI backend**.

------------------------------------------------------------------------

## 🚀 Core Features

-   📄 **Document Analysis**: Upload PDF, TXT, or DOCX files and ask
    questions about their content.\
-   ✂️ **Semantic Chunking**: Documents are split using an advanced,
    context-aware chunking strategy for more accurate answers.\
-   ⚡ **Vectorization Caching**: Previously uploaded documents are
    retrieved from memory, skipping the need for re-processing.\
-   💬 **Persistent Chat History**: User authentication and chat history
    are securely handled by Google Firebase.

------------------------------------------------------------------------

## 🛠 Technology Stack

  -----------------------------------------------------------------------
  Area                                    Technology
  --------------------------------------- -------------------------------
  **Backend**                             Python, FastAPI, LangChain

  **Frontend**                            React.js

  **Database**                            Pinecone (Vector DB), Google
                                          Firestore (Chat History)

  **AI / ML**                             Google Gemini

  **Auth**                                Firebase Authentication
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## ⚙️ Setup and Installation

### Step 1: Install Frontend Dependencies

From the project's root directory (`rag-chatbot/`), run the following
command to install all necessary packages for the React application:

``` bash
npm install react react-dom firebase lucide-react remove-markdown
```

------------------------------------------------------------------------

### Step 2: Set Up the Backend

Navigate to the server directory:

``` bash
cd src/server
```

Create and activate a Python virtual environment.

Install all required Python dependencies:

``` bash
pip install -r requirements.txt
```

Create a `.env` file inside `src/server/` and add your API keys:

``` ini
GOOGLE_API_KEY="your_google_api_key"
PINECONE_API_KEY="your_pinecone_api_key"
PINECONE_INDEX_NAME="your-chosen-index-name"
```

Run the FastAPI server:

``` bash
uvicorn main:app --reload
```

The backend will be live at **http://127.0.0.1:8000**.

------------------------------------------------------------------------

### Step 3: Set Up the Frontend

Create a `.env` file in the project's root directory for your Firebase
configuration.

Start the React development server from the root directory:

``` bash
npm start
```

------------------------------------------------------------------------

✅ You now have the **Advanced RAG AI Chatbot** running locally!
