package kr.example.legacy

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class LegacyOrderApplication

fun main(args: Array<String>) {
    runApplication<LegacyOrderApplication>(*args)
}
