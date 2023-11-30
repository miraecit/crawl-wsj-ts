import chalk from "chalk"

type LEVEL = "DEV" | "PROD"

class log {

    private static level: LEVEL = "DEV"

    static setLevel (level: LEVEL) {
        this.level = level
    }

    static info (message: string) {
        console.log(chalk.green.bold('[INFO] ') + message)
    }

    static warn (message: string) {
        console.log(chalk.yellow.bold('[WARN] ') + message)
    }

    static danger (message: string) {
        console.log(chalk.red.bold + '[DANGER] ' + message)
    }

    static debug (message: string) {
        if (this.level === "DEV") {
            console.log(chalk.cyan.bold('[DEBUG] ') + message)
        } 
    }
}

export {log, LEVEL}