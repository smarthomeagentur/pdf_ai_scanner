### VAR SETUP

INTERVALL : Interval in seconds to check adobe cloud for updates
FILE_FOLDER_NAME : Folder name in adobe cloud to sync. default: "Adobe Scan"
ADOBE_USERNAME : your adobe cloud username
ADOBE_PASSWORD : your adobe cloud pw
CREDENTIALS_PATH : path of the gdrive json auth file. check readme for more. defaut: path.join(process.cwd(), "gdrive_secret.json");

### ADOBE AUTH

On the first login a browser will open and guide you trough the adobe login process to create a login cookie. you will likely get a email with a confirmation code that needs to be entered

### GDRIVE AUTH

for google drive auth json check this: https://developers.google.com/drive/api/quickstart/nodejs . After you created this json best put it in the same folder as the script and set the path in the CREDENTIALS_PATH var.
On the first start you will get the OAUTH Screen in your browser. select your google account and grand all the access to google drive. After that a token.json file will be created for login

### Notes

The script is based on playwright. So you need to have a instance of it ready and setup. It definitly works also in WSL2 in windows 11.

- dont use "share file" in adobe cloud. if there are new files that are shared, the script will crash (WIP)
