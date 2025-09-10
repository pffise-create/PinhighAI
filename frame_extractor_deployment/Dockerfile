FROM public.ecr.aws/lambda/python:3.9

# Copy requirements and install dependencies
COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install -r requirements.txt

# Copy function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}

# Install ffmpeg for video processing
RUN yum install -y https://download1.rpmfusion.org/free/el/rpmfusion-free-release-8.noarch.rpm && \
    yum install -y ffmpeg

CMD [ "lambda_function.lambda_handler" ]