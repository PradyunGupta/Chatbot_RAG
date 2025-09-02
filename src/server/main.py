import os
import tempfile
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import uvicorn
from operator import itemgetter
from fastapi.responses import Response, JSONResponse
from starlette.status import HTTP_204_NO_CONTENT

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_pinecone import Pinecone as PineconeVectorStore
from pinecone import Pinecone as PineconeClient, ServerlessSpec
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableParallel
from langchain_core.output_parsers import StrOutputParser
from dotenv import load_dotenv

from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain.retrievers.multi_query import MultiQueryRetriever


load_dotenv()

class EndpointFilter(logging.Filter):
    def __init__(self, paths_to_exclude: list[str]):
        self.paths_to_exclude = paths_to_exclude

    def filter(self, record: logging.LogRecord) -> bool:
        if len(record.args) >= 3:
            request_path = record.args[2]
            return all(path not in request_path for path in self.paths_to_exclude)
        return True

uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.addFilter(EndpointFilter(paths_to_exclude=["/favicon.ico", "/v1/models"]))



required_env_vars = ["PINECONE_API_KEY", "GOOGLE_API_KEY", "PINECONE_INDEX_NAME"]
missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")


app = FastAPI(
    title="LangChain RAG Chatbot with Gemini",
    description="A chatbot API using LangChain, Gemini, and Pinecone for Retrieval-Augmented Generation.",
    version="1.0.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


try:
    llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=GOOGLE_API_KEY, temperature=0.7)
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001", google_api_key=GOOGLE_API_KEY)
    pc = PineconeClient(api_key=PINECONE_API_KEY)

    GEMINI_EMBEDDING_DIMENSION = 768

    if PINECONE_INDEX_NAME not in pc.list_indexes().names():
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=GEMINI_EMBEDDING_DIMENSION,
            metric="cosine",
            spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION)
        )

    vectorstore = PineconeVectorStore.from_existing_index(
        index_name=PINECONE_INDEX_NAME,
        embedding=embeddings,
        text_key="text"
    )

except Exception as e:
    raise RuntimeError(f"Failed to initialize external services: {e}")



class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    document_id: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str

class UploadResponse(BaseModel):
    message: str
    document_id: str



def get_document_loader(file_path: str, file_name: str):
    file_extension = os.path.splitext(file_name)[1].lower()
    if file_extension == ".pdf":
        return PyPDFLoader(file_path)
    elif file_extension == ".docx":
        return Docx2txtLoader(file_path)
    elif file_extension == ".txt":
        return TextLoader(file_path)
    else:
        raise ValueError(f"Unsupported file type: {file_extension}")

def process_and_vectorize_document(tmp_path: str, file_name: str, file_size: int):
    try:
        print(f"Background task started for: {file_name}")
        loader = get_document_loader(tmp_path, file_name)
        documents = loader.load()
        
        full_text = "\n".join(doc.page_content for doc in documents)

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
        chunks = text_splitter.split_text(full_text)

        document_id = f"{file_name}_{file_size}"
        vectorstore.add_texts(texts=chunks, namespace=document_id)
        
        print(f"✅ Background vectorization complete for: {document_id}")

    except Exception as e:
        print(f"❌ Error processing file in background '{file_name}': {e}")
    finally:
        os.remove(tmp_path)
        print(f"🗑️ Cleaned up temporary file: {tmp_path}")



@app.post("/upload", response_model=UploadResponse, status_code=202)
async def upload_document(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    try:
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        document_id = f"{file.filename}_{file.size}"
        
        background_tasks.add_task(process_and_vectorize_document, tmp_path, file.filename, file.size)

        return {
            "message": "File upload accepted and is being processed.",
            "document_id": document_id
        }

    except Exception as e:
        print(f"Error initiating file upload: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to initiate file processing: {str(e)}")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=HTTP_204_NO_CONTENT)

@app.get("/v1/models", include_in_schema=False)
async def get_models():
    return JSONResponse(content={"data": []})


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    try:
        history_messages = [
            HumanMessage(content=msg['content']) if msg['role'] == 'user' else AIMessage(content=msg['content'])
            for msg in request.history
        ]

        if request.document_id:
            print(f"---RAG CHAT for doc: {request.document_id}---")
            
            base_retriever = vectorstore.as_retriever(search_kwargs={'namespace': request.document_id, 'k': 7})
            
            # Use MultiQueryRetriever to improve retrieval accuracy
            retriever = MultiQueryRetriever.from_llm(
                retriever=base_retriever,
                llm=llm
            )

            def format_docs(docs):
                return "\n\n".join(doc.page_content for doc in docs)

            rag_prompt = ChatPromptTemplate.from_messages([
                ("system", (
                    "You are an expert assistant. Your task is to provide a detailed and comprehensive answer to the user's question "
                    "based *only* on the following retrieved context. Synthesize the information, explain key concepts, and include "
                    "relevant details from the text. If the answer is not present in the context, state that you cannot answer "
                    "based on the provided document.\n\n"
                    "Context:\n{context}"
                )),
                MessagesPlaceholder(variable_name="chat_history"),
                ("human", "{question}")
            ])

            rag_chain = (
                RunnableParallel(
                    context=itemgetter("question") | retriever | format_docs,
                    question=itemgetter("question"),
                    chat_history=itemgetter("chat_history")
                )
                | rag_prompt
                | llm
                | StrOutputParser()
            )
            
            bot_reply = rag_chain.invoke({
                "question": request.message,
                "chat_history": history_messages
            })

        else:
            print("---GENERAL CHAT---")
            general_prompt = ChatPromptTemplate.from_messages([
                ("system", "You are a helpful assistant. Answer the user's question based on the conversation history."),
                MessagesPlaceholder(variable_name="chat_history"),
                ("human", "{question}"),
            ])

            general_chain = general_prompt | llm | StrOutputParser()

            bot_reply = general_chain.invoke({
                "question": request.message,
                "chat_history": history_messages
            })

        return {"reply": bot_reply}

    except Exception as e:
        print(f"Error during chat: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred during chat processing: {str(e)}")

@app.get("/")
def read_root():
    return {"message": "LangChain Chatbot API with Gemini is running."}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)