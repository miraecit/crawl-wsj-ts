

import 'dotenv/config'
import puppeteer, { Browser, HTTPRequest, Page } from 'puppeteer';
import cheerio from 'cheerio'
import chalk from 'chalk';
import mysql from 'mysql2/promise'


import { Content, PageInfo } from './types';
import { log } from './log';


(async () => {    
    const pool = mysql.createPool({
        "host":            "localhost",
        "user":            process.env.DB_ID,
        "password":        process.env.DB_PW,
        "database":        process.env.DB_SCHMA,
        "connectionLimit": 1
    })

    const brw: Browser = await puppeteer.launch({headless: 'new', timeout: 50000, args: ['--no-sandbox', '--disable-setuid-sandbox']})
    const pge: Page = await brw.newPage()
    await brwInitalize(pge)

    const connection = await pool.getConnection()
    try { 
        await login(pge)
        await crwal(pge, connection)
    }
    catch (err) {
        log.danger(chalk.yellow.bold('stop'))
        log.danger(<string>err)
    }
    finally {
        connection.release()
        brw.close()
    } 
})()



async function crwal (pge: Page, conn: mysql.PoolConnection): Promise<void> {
    let date = formatAndSubtractDay(new Date())
    let info: PageInfo = await getPageInfo(pge, urlBuilder(date.text, 1))
    
    while (true) {
        if (info.urls.length === 0) { break }

        for (let page=2; page<(parseInt(info.totalPages)+1); page++) {
            for (const url of info.urls) {
                log.info(chalk.bold(url) + ' crawling...')

                const content: Content | null = await getContent(pge, url)
                if (content !== null) {
                    const sqlStatement = `INSERT INTO news (origin, title, content, category, url, created) VALUES (?, ?, ?, ?, ?, ?);`
                    conn.query(sqlStatement, ['wsj', content.title, content.content, content.category, content.url, date.tmp.replace('/', '-').replace('/', '-')])                    
                }
            }
        }

        date = formatAndSubtractDay(date.before)
        info = await getPageInfo(pge, urlBuilder(date.text, 1))
    }
}



async function brwInitalize (pge: Page) {
    process.title = 'crawller-wsj'
    await pge.setViewport({ height: 1920, width: 1080 })
    await pge.setRequestInterception(true)
    pge.on('request', (req: HTTPRequest) => {
        if (req.resourceType() === 'image' || req.resourceType() === 'font' || req.resourceType() === 'media') req.abort()
        else { req.continue() }
    })
}



async function getContent (pge: Page, url: string): Promise<Content | null> {
    await pge.goto(url, {waitUntil: 'domcontentloaded'})
    await pge.mouse.wheel({deltaY: 5000})
    await delay(1500)
    try {
        // //*[@id="__next"]/div/main/div[2]/article/div[2]/section
        await pge.waitForXPath('//*[@id="__next"]/div/main/div[2]/article')
    }
    catch {
        log.warn(pge.url() + ' PASS CRAWL')
        return null
    }

    const $     = cheerio.load(await pge.content())
    const title = $('#__next > div > main > div.article-container.css-1fasr7.e1wkb4h45 > div.article-header.css-exmfr.e1wkb4h43 > div > div.crawler.css-1skj0ht-Box.e1vnmyci0 > div > h1').text()
    const date  = $('#__next > div > main > div.article-container.css-1fasr7.e1wkb4h45 > article > div.crawler.css-symnra.eui4bu21 > div.eui4bu20.css-hb9xd5 > div > div > div > div.css-11paagg > div > p').text()
    const texts = $('#__next > div > main > div.article-container.css-1fasr7.e1wkb4h45 > article > div.crawler.css-symnra.eui4bu21 > section').find('p')

    let content = ""
    for (const text of texts) content += $(text).text()
    
    return {title, content, date, url: pge.url(), category: parseCategory(pge)}
}



async function getUrls (pge: Page): Promise<Array<string>> {
    const result: Array<string> = new Array()

    await pge.waitForXPath('//*[@id="main"]/div[1]/div/ol')

    const html     = await pge.content()
    const $        = cheerio.load(html)
    const articles = $('div > ol > article')

    for (const article of articles) {
        const href = <string>$(article).find('div.WSJTheme--overflow-hidden--qJmlzHgO > div:nth-child(2) > div > h2 > a').attr('href')
        result.push(href)
    }

    return result
}



async function getPageInfo (pge: Page, url: string): Promise<PageInfo> {
    await pge.goto(url, {waitUntil: 'domcontentloaded'})
    const $ = cheerio.load(await pge.content())
    const totalPages = $('#main > div.WSJTheme--SimplePaginator--2idkJneR.WSJTheme--secondary--1BGbEF8e > div > div > div > span').text()
    return {urls: await getUrls(pge), totalPages: totalPages.split(' ')[1]}
}



async function login (pge: Page): Promise<void> {
    await pge.goto('https://www.wsj.com/client/login?target=https%3A%2F%2Fwww.wsj.com%2F', {waitUntil: 'load'})
    await pge.type('#username', <string>process.env.WSJ_ID)
    await pge.click('#basic-login > div:nth-child(1) > form > div:nth-child(2) > div:nth-child(6) > div.sign-in.hide-if-one-time-linking > button.solid-button.continue-submit.new-design')
    await pge.waitForTimeout(2000)
    await pge.type('#password-login-password', <string>process.env.WSJ_PW)
    await pge.click('#password-login > div > form > div > div:nth-child(5) > div.sign-in.hide-if-one-time-linking > button')
    await pge.waitForNavigation({waitUntil: 'domcontentloaded'})
    await pge.waitForTimeout(2000)
    await pge.click('#email-verification > div > div.resend-verification-email > div > div:nth-child(2) > div > div > button.solid-button.reg-rtl-btn')
    await delay(2000)
    log.info('login done')
}



function urlBuilder (date: string, page: number): string {
    return "https://www.wsj.com/news/archive/" + date + '?page=' + page 
}



function parseCategory (pge: Page): string {
    const category = pge.url().replace('//', '').split('/')[2]
    if ((category.split('-').length - 1) >= 3) {
        return category.split('-')[0] + ' ' + category.split('-')[1]
    }

    return pge.url().replace('//', '').split('/')[2]
}



function formatAndSubtractDay (date: Date): {text: string; before: Date; tmp: string} {
    const originalDate = new Date(date);
    const newDate = new Date(originalDate);
    newDate.setDate(originalDate.getDate() - 1);
    function formatDate(date: Date) {
        return date.toISOString().slice(0, 10).replace(/-/g, '/');
    }
    return {
        tmp: formatDate(originalDate),
        text: formatDate(newDate),
        before: newDate
    }
}  



function delay (time: number) {
    return new Promise((resolve) => { 
        setTimeout(resolve, time)
    })
}
