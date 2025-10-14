export interface PlannerExample {
  diff: string;
  prompt: string;
}

import diff_d7763789f262b2da228f8210509e302e6e510d0a from "~/planner/examples/d7763789f262b2da228f8210509e302e6e510d0a.txt";

export const plannerExamples: PlannerExample[] = [
  {
    diff: diff_d7763789f262b2da228f8210509e302e6e510d0a,
    prompt: `Add a new feature to count the number of "batchItemFailures" returned by a Lambda function and emit a new enhanced metric for the value. It should be named \`aws.lambda.enhanced.batch_item_failures\`. The metric should be created in metric.py and set in the \`_after\` method in \`wrapper.py\` based on the \`self.response\` object. The docs for this are
\`\`\`
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

def lambda_handler(event, context):
    if event:
        batch_item_failures = []
        sqs_batch_response = {}

        for record in event["Records"]:
            try:
                print(f"Processed message: {record['body']}")
            except Exception as e:
                batch_item_failures.append({"itemIdentifier": record['messageId']})

        sqs_batch_response["batchItemFailures"] = batch_item_failures
        return sqs_batch_response
\`\`\``,
  },
];
