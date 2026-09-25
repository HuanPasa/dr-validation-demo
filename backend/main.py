from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import os

from s3_client import upload_to_s3


app = FastAPI(
    title="DR Validation Backend",
    version="1.0"
)


# =========================
# CORS
# =========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# =========================
# DATABASE
# =========================

def db_connect():

    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )



# =========================
# HEALTH
# =========================

@app.get("/")
def home():

    return {
        "application":"DR Validation Backend",
        "status":"running"
    }



@app.get("/health")
def health():

    result = {
        "application":"DR Validation Backend",
        "database":"UNKNOWN",
        "s3":"UNKNOWN"
    }


    # test DB

    try:

        conn = db_connect()
        conn.close()

        result["database"]="CONNECTED"

    except Exception as e:

        result["database"]=str(e)



    # test S3

    try:

        from s3_client import get_s3_client

        s3 = get_s3_client()

        s3.list_buckets()

        result["s3"]="CONNECTED"


    except Exception as e:

        result["s3"]=str(e)



    return result



# =========================
# GET CUSTOMER
# =========================

@app.get("/customer")
def get_customer():

    conn = db_connect()
    cur = conn.cursor()


    cur.execute(
        """
        SELECT
        id,
        name,
        email,
        company,
        created_at

        FROM customer

        ORDER BY id
        """
    )


    rows = cur.fetchall()


    cur.close()
    conn.close()


    data=[]


    for row in rows:

        data.append(
            {
                "id":row[0],
                "name":row[1],
                "email":row[2],
                "company":row[3],
                "created_at":row[4]
            }
        )


    return data




# =========================
# CREATE CUSTOMER
# =========================

@app.post("/customer")
def create_customer(
    name:str,
    email:str,
    company:str
):

    conn=db_connect()
    cur=conn.cursor()


    cur.execute(
        """
        INSERT INTO customer
        (name,email,company)

        VALUES
        (%s,%s,%s)

        RETURNING id
        """,
        (
            name,
            email,
            company
        )
    )


    customer_id=cur.fetchone()[0]


    conn.commit()


    cur.close()
    conn.close()


    return {

        "status":"created",
        "id":customer_id

    }




# =========================
# UPDATE CUSTOMER
# =========================

@app.put("/customer/{customer_id}")
def update_customer(
    customer_id:int,
    name:str,
    email:str,
    company:str
):

    conn=db_connect()
    cur=conn.cursor()


    cur.execute(
        """
        UPDATE customer

        SET
        name=%s,
        email=%s,
        company=%s

        WHERE id=%s
        """,
        (
            name,
            email,
            company,
            customer_id
        )
    )


    conn.commit()


    cur.close()
    conn.close()


    return {

        "status":"updated",
        "id":customer_id

    }





# =========================
# DELETE CUSTOMER
# =========================

@app.delete("/customer/{customer_id}")
def delete_customer(customer_id:int):

    conn=db_connect()
    cur=conn.cursor()


    cur.execute(
        """
        DELETE FROM customer
        WHERE id=%s
        """,
        (customer_id,)
    )


    conn.commit()


    cur.close()
    conn.close()


    return {

        "status":"deleted",
        "id":customer_id

    }




# =========================
# UPLOAD FILE TO S3
# =========================

@app.post("/upload")
def upload_document(
    file:UploadFile = File(...)
):

    result = upload_to_s3(
        file.file,
        file.filename
    )


    # simpan metadata

    conn=db_connect()
    cur=conn.cursor()


    cur.execute(
        """
        INSERT INTO documents
        (
        filename,
        bucket,
        object_key
        )

        VALUES
        (%s,%s,%s)
        """,
        (
            file.filename,
            result["bucket"],
            result["object"]
        )
    )


    conn.commit()


    cur.close()
    conn.close()



    return {

        "status":"uploaded",
        "filename":file.filename,
        "storage":result

    }

@app.get("/documents")
def get_documents():

    conn=db_connect()
    cur=conn.cursor()

    cur.execute(
        """
        SELECT
        id,
        filename,
        bucket,
        object_key,
        uploaded_at
        FROM documents
        ORDER BY id DESC
        """
    )

    rows=cur.fetchall()

    cur.close()
    conn.close()


    return [
        {
            "id":r[0],
            "filename":r[1],
            "bucket":r[2],
            "object_key":r[3],
            "uploaded_at":r[4]
        }
        for r in rows
    ]