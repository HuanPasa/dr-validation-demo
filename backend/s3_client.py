import boto3
import os


def get_s3_client():

    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY")
    )


def upload_to_s3(file, filename):

    s3 = get_s3_client()

    bucket = os.getenv("S3_BUCKET")


    s3.upload_fileobj(
        file,
        bucket,
        filename
    )


    return {
        "bucket": bucket,
        "object": filename
    }